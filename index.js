/**
 * @file The entire timline renderer/optimizer application is contained in this file.
 * The design goal is simplicity and minimizing dependencies. It is pure JavaScript,
 * does not require a bundler or framework, and can be loaded by any HTML page
 * that contains the below global HTMLElements.
 *
 * @license
 * Copyright (c) 2023-2024 Gary Gurlaskie
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const container = document.getElementById("container");
const monacoContainer = document.getElementById("monaco-container");
const downloadButton = document.getElementById("download-button");
const clipboardButton = document.getElementById("clipboard-button");
const randomizeButton = document.getElementById("randomize-button");
const tabsButton = document.getElementById("tabs-button");
const viewTab = document.getElementById("view-tab");
const editorTab = document.getElementById("editor-tab");
const fixedIntervalsButton = document.getElementById("fixedintervals-button");
const statusField = document.getElementById("status-field");
const localStorageCheckbox = document.getElementById("localstorage-checkbox");
const localStorageCheckboxLabel = document.getElementById("localstorage-checkbox-label");
const localStorageCheckboxClickArea = document.getElementById("localstorage-checkbox-clickarea");

const TIMELINE_LOCAL_STORAGE_KEY = "_garygurlaskie_com_timelines";
const GFONT_LOCAL_STORAGE_KEY = "_garygurlaskie_com_gfont";
const DEFAULT_WIDTH = 800;
const DEFAULT_USE_DATE_LABELS = true;
const DEFAULT_FONT = "sans-serif";
const STROKE_THRESHOLD = 210;
const MIN_CONTRAST_L1 = 80;
const STROKE_DARKNESS = 0.25;
const TEXT_LABEL_OPACITY = 0.8;
const MASK_STRENGTH = 0.15;
const MASK_SIZE = 6;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_GRID_TICKS = 10;
const DEFAULT_COLOR = "#3c5ca2";
const LINK_COLOR = "#3c5ca2";
const DEFAULT_PADDING_TASKHEIGHT = 15;
const DEFAULT_PADDING_TASKS = 5;
const DEFAULT_PADDING_SWIMLANES = 5;
const DEFAULT_PADDING_CHARTX = 10;
const DEFAULT_PADDING_CHARTY = 5;
const DEFAULT_PADDING_TEXT_LINE_HEIGHT = 1.1;
const DEFAULT_TASKNAMES_FONTSIZE = 12;
const DEFAULT_TASKDATES_FONTSIZE = 10;
const DEFAULT_TITLE_FONTSIZE = 22;
const START_DATE_ISO = dateToIso(new Date());
const Z3_MAX_MEMORY_MB = "512";
const Z3_TIMEOUT_GROWTH_RATE = 3;
const Z3_INITIAL_TIMEOUT_MS = 2000;
const Z3_MAX_TIMEOUT_MS = 180_000;
// <rect> and <text> do not align properly in chrome (2023-12-23), need very small adjustment
const RECT_TEXT_ALIGNMENT_OFFSET_HACK_PIXELS = 0.75;
// https://stackoverflow.com/questions/11526504
// If date/null handling code is wrong things will go very badly.
// This will make errors easy to detect.
const JS_MIN_DATE = new Date(-8640000000000000);
const JS_MAX_DATE = new Date(8640000000000000);
const COMPLETED_EMOJI = "✓";
const VIRTUAL_SWIMLANE_ID = "_milestonevirtualswimlane";

let _z3 = null;
let _debugGlobalMonacoEditor;
let _timeline = makeSampleTimeline();
let _fontToLoad = null;
let _lastKnownJson = null;
let _mutated = false;
var _randomTaskId = 1;
let _getText = null;
let _overwriteText = null;
let _setThemeCb = null;
let _renderNeeded = false;
let _scheduledTimeline = null;
window._hasGfontConsent = window.localStorage.getItem(GFONT_LOCAL_STORAGE_KEY);
let _lastSolverCacheKey = null;
let _lastSolverUsed = null;
const _solutionCache = {};
const _loadedGoogleFonts = [];
const _triedFonts = new Set();
const _loadedWoff2s = {};
// https://developer.mozilla.org/en-US/docs/Web/CSS/font-family#generic-name
const _cssFontGenericNames = [
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "math",
    "emoji",
    "fangsong",
];

setupPageLeavePrompt();

setupThreeStateButton(downloadButton, ["Download PNG", "...", "Download started!"], downloadPng);
setupThreeStateButton(clipboardButton, ["Copy to Clipboard", "...", "Copied!"], copyPngToClipboard);
setupThreeStateButton(
    randomizeButton,
    ["Randomize Style", "...", "Randomized!"],
    writeRandomizedConfigToMonaco,
);
setupThreeStateButton(
    fixedIntervalsButton,
    ["Write Optimized Schedule", "...", "Written!"],
    writeOptimizedScheduleToMonaco,
);

setupTabs(
    tabsButton,
    [
        ["Editor", editorTab],
        ["Rendered Chart", viewTab],
    ],
    LINK_COLOR,
);

const [
    notifyOptimizing,
    notifyOptimizingWithTimeout,
    notifyRendering,
    notifyRendered,
    notifyFailed,
] = setupStatusDisplay(statusField, [
    "Optimizing...",
    /** @param {number} timeoutMs */
    timeoutMs => `Optimizing (${timeoutMs.toLocaleString()}ms)...`,
    "Rendering...",
    "Rendered",
    /** @param {string[]} failureMessages */
    (...failureMessages) => `Failed\n${failureMessages.join("\n")}`,
]);

const isLocalStorageEnabled = setupFourStateToggle(
    localStorageCheckbox,
    localStorageCheckboxLabel,
    readFromLocalStorage()[0],
    ["Persisted", "Cleared local storage.", "Not persisted", "Persisting!"],
    [LINK_COLOR, "grey", "grey", LINK_COLOR],
    async isOn => (isOn ? initLocalStorage() : clearLocalStorage()),
);

function stringifyJson(object) {
    return prettifyJson(object, 4, 75);
}

/**
 * https://github.com/garyg1/json-formatter/blob/main/formatter.js
 * @param {any} object
 * @param {number} indent
 * @param {number} lineLength
 * @returns {string}
 */
function prettifyJson(object, indent, lineLength) {
    const ARRAY_SEP = ", ";
    const OBJ_KV_SEP = ": ";

    /**
     *
     * @param {any} o
     * @returns {o is any[]}
     */
    function isArray(o) {
        return Array.isArray(o);
    }

    /**
     * @param {any} o
     * @returns {o is Object<string, any>}
     */
    function isObject(o) {
        // https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
        return typeof o === "object" && o !== null;
    }

    /** @param {number[]} arr */
    function sumArray(arr) {
        return arr.reduce((s, e) => s + e, 0);
    }

    const singleLineLengths = {};
    function getSingleLineLength(o) {
        let ans = 0;
        if (isArray(o)) {
            ans = sumArray(o.map(e => getSingleLineLength(e) + ARRAY_SEP.length));
            ans += "[]".length;
            if (o.length > 0) {
                ans -= ARRAY_SEP.length;
            }
        } else if (isObject(o)) {
            ans = sumArray(
                Object.entries(o).map(
                    kv =>
                        JSON.stringify(kv[0]).length +
                        OBJ_KV_SEP.length +
                        getSingleLineLength(kv[1]) +
                        ARRAY_SEP.length,
                ),
            );
            ans += "{  }".length;
            if (Object.keys(o).length > 0) {
                ans -= ARRAY_SEP.length;
            }
        } else {
            ans = JSON.stringify(o)?.length ?? 0;
        }

        singleLineLengths[o] = ans;
        return ans;
    }

    /**
     * @param {any} currentNode
     * @param {number} currIndent
     * @param {number} nextIndent
     * @param {boolean} forceSingleLine
     * @returns {string}
     */
    function getPrettyRepresentation(currentNode, currIndent, nextIndent, forceSingleLine) {
        const currLineWidth = lineLength - currIndent;
        const nextLineWidth = lineLength - nextIndent;
        if (isArray(currentNode)) {
            if (getSingleLineLength(currentNode) < currLineWidth || forceSingleLine) {
                return [
                    "[",
                    currentNode.map(e => getPrettyRepresentation(e, 0, 0, true)).join(ARRAY_SEP),
                    "]",
                ].join("");
            } else if (getSingleLineLength(currentNode) + indent < nextLineWidth) {
                return [
                    "[\n",
                    " ".repeat(nextIndent + indent),
                    currentNode.map(e => getPrettyRepresentation(e, 0, 0, true)).join(ARRAY_SEP),
                    "\n",
                    " ".repeat(nextIndent),
                    "]",
                ].join("");
            } else {
                const ans = ["[\n"];
                for (const e of currentNode) {
                    ans.push(" ".repeat(nextIndent + indent));
                    ans.push(getPrettyRepresentation(e, nextIndent + indent, nextIndent + indent));
                    ans.push(ARRAY_SEP);
                    ans.push("\n");
                }

                ans.pop();
                ans.pop();
                ans.push("\n");

                ans.push(" ".repeat(nextIndent));
                ans.push("]");
                return ans.join("");
            }
        } else if (isObject(currentNode)) {
            if (getSingleLineLength(currentNode) < currLineWidth || forceSingleLine) {
                return [
                    "{ ",
                    Object.entries(currentNode)
                        .map(kvp =>
                            [
                                getPrettyRepresentation(kvp[0], 0, 0, true),
                                OBJ_KV_SEP,
                                getPrettyRepresentation(kvp[1], 0, 0, true),
                            ].join(""),
                        )
                        .join(ARRAY_SEP),
                    " }",
                ].join("");
            } else {
                const ans = ["{\n"];
                for (const [k, v] of Object.entries(currentNode)) {
                    ans.push(" ".repeat(nextIndent + indent));
                    ans.push(JSON.stringify(k));
                    ans.push(OBJ_KV_SEP);
                    ans.push(
                        getPrettyRepresentation(
                            v,
                            nextIndent + indent + JSON.stringify(k).length + OBJ_KV_SEP.length,
                            nextIndent + indent,
                        ),
                    );
                    ans.push(ARRAY_SEP);
                    ans.push("\n");
                }
                ans.pop();
                ans.pop();
                ans.push("\n");

                ans.push(" ".repeat(nextIndent));
                ans.push("}");
                return ans.join("");
            }
        } else {
            return JSON.stringify(currentNode);
        }
    }

    const result = getPrettyRepresentation(object, 0, 0);
    const trimmedResult = result
        .split("\n")
        .map(s => s.trimEnd())
        .join("\n");
    return trimmedResult;
}

/**
 * @typedef {ReturnType<makeSampleTimeline>} Timeline
 * @typedef {Timeline['swimlanes'][0]} Swimlane
 * @typedef {Timeline['config']} Config
 * @typedef {Timeline['tasks'][0]} Task
 * @typedef {Timeline['milestones'][0]} Milestone
 */
function makeSampleTimeline() {
    const taskSet1 = makeRandomTaskDAG(["1", "1", "1", "2"], 4);
    const taskSet2 = makeRandomTaskDAG(["1", "2", "3", "4", "5"], 12);
    const timeline = {
        title: "Project A",
        config: {
            width: 700,
            font: "sans-serif",
            startDate: START_DATE_ISO,
            palette: {
                gradient: ["#3c5ca2", "seagreen", "#eee"],
                backgroundColor: "white",
                outlines: {
                    thresholdL1: STROKE_THRESHOLD,
                    strength: STROKE_DARKNESS,
                },
            },
            showDeps: false,
            showCriticalPaths: false,
            dateLabels: true,
            padding: {
                tasks: DEFAULT_PADDING_TASKS,
                taskHeight: DEFAULT_PADDING_TASKHEIGHT,
                swimlanes: DEFAULT_PADDING_SWIMLANES,
                chartX: DEFAULT_PADDING_CHARTX,
                chartY: DEFAULT_PADDING_CHARTY,
                textLineHeight: DEFAULT_PADDING_TEXT_LINE_HEIGHT,
            },
            fontSizes: {
                taskNames: DEFAULT_TASKNAMES_FONTSIZE,
                taskDates: DEFAULT_TASKDATES_FONTSIZE,
                title: DEFAULT_TITLE_FONTSIZE,
            },
        },
        swimlanes: [
            { id: "1", name: "A", maxParallelism: 3 },
            { id: "2", name: "B", maxParallelism: 2 },
            { id: "3", name: "C", maxParallelism: 1, hidden: false },
            { id: "4", name: "D", groupedWith: "3" },
            { id: "5", name: "E", maxParallelism: 2 },
        ],
        milestones: [
            makeRandomMilestone("Milestone 1", null, START_DATE_ISO),
            makeRandomMilestone(
                "Milestone 2",
                taskSet1.map(t => t.name),
            ),
        ],
        tasks: [
            ...taskSet1,
            ...taskSet2,
            makeRandomFixedTask("Fixed Task A", "1"),
            makeRandomFixedTask("Fixed Task B", "2"),
        ],
    };

    // remove from user examples, but keep type hints
    delete timeline.config.palette.outlines;
    delete timeline.config.padding;
    delete timeline.config.fontSizes;
    delete timeline.config.dateLabels;
    delete timeline.config.startDate;

    return timeline;
}

/**
 * @param {string[]} swimlaneIds
 * @param {number} numTasks
 */
function makeRandomTaskDAG(swimlaneIds, numTasks) {
    _randomTaskId = _randomTaskId || 1;
    const getName = () => `Task ${_randomTaskId++}`;
    const getSwimlane = () => randChoice(swimlaneIds);
    const tasks = [makeRandomFloatingTask(getName(), swimlaneIds[0], [])];
    for (const id of swimlaneIds.slice(1)) {
        tasks.push(makeRandomFloatingTask(getName(), id, [tasks[tasks.length - 1].name]));
    }

    while (tasks.length < numTasks) {
        const numParents = randChoice([0, 1, 1, 1, 1, 2]);
        const parentIdxes = [
            ...new Set(zeroArray(numParents).map(_ => randRange(0, tasks.length))),
        ];
        tasks.push(
            makeRandomFloatingTask(
                getName(),
                getSwimlane(),
                parentIdxes.map(i => tasks[i].name),
            ),
        );
    }

    tasks[0].completed = true;
    tasks[0].importance = 2;

    return tasks;
}

/**
 * @param {string} name
 * @param {string} swimlaneId
 */
function makeRandomFixedTask(name, swimlaneId) {
    const startDays = randRange(1, 100);
    const durationDays = randRange(4, 45);

    return {
        name,
        swimlaneId,
        interval: {
            start: dateToIso(addDays(START_DATE_ISO, startDays)),
            end: dateToIso(addDays(START_DATE_ISO, startDays + durationDays)),
        },
    };
}

/**
 * @param {string} name
 * @param {string} swimlaneId
 * @param {string[]} deps
 */
function makeRandomFloatingTask(name, swimlaneId, deps) {
    const durationDays = randRange(10, 25);
    const task = {
        name,
        swimlaneId,
        duration: durationDays % 7 == 0 ? `P${durationDays / 7}W` : `P${durationDays}D`,
        deps: deps || [],
    };
    // show width = 1 as example
    if (Math.random() > 0.8) {
        task.width = 1;
    }
    return task;
}

/**
 * @param {string} name
 * @param {string[]} deps
 */
function makeRandomMilestone(name, deps, exactly) {
    const milestone = {
        name,
        swimlaneId: "",
        deps: deps,
        /** @type {boolean?} */
        completed: null,
        hidden: false,
        interval: { exactly: exactly },
    };

    // remove from user examples, but keep type hints
    delete milestone.swimlaneId;
    delete milestone.completed;
    delete milestone.hidden;
    if (!exactly) {
        delete milestone.interval;
    }
    if (!deps) {
        delete milestone.deps;
    }

    return milestone;
}

/**
 * @param {HTMLElement} textElt
 * @param {(string | (...args) => string )[]} statuses
 * @returns {(() => {})[]} setStatus
 */
function setupStatusDisplay(textElt, statuses) {
    return statuses.map(statusOrGetStatus => (...args) => {
        if (typeof statusOrGetStatus === "string") {
            textElt.innerText = statusOrGetStatus;
        } else {
            textElt.innerText = statusOrGetStatus(...args);
        }
    });
}

/**
 * @param {HTMLInputElement} checkboxElt
 * @param {HTMLLabelElement} labelElt
 * @param {boolean} initialValue
 * @param {[string, string, string, string]} labels
 * @param {[string, string, string, string]} textColors
 * @param {(boolean) => Promise} action
 */
function setupFourStateToggle(checkboxElt, labelElt, initialValue, labels, textColors, action) {
    labels = labels.slice();
    const setText = idx => {
        labelElt.innerText = labels[idx];
        labelElt.style.color = textColors[idx];
    };
    const updateState = async () => {
        const checked = checkboxElt.checked;
        await action(checked);
        setText(checked ? 3 : 1);
        setTimeout(() => setText(checked ? 0 : 2), 500);
    };

    checkboxElt.checked = initialValue;
    setText(initialValue ? 0 : 2);
    labelElt.onclick = async e => {
        e.preventDefault();
        checkboxElt.checked = !checkboxElt.checked;
        await updateState();
    };
    checkboxElt.onchange = async e => {
        e.preventDefault();
        await updateState();
    };
    return () => checkboxElt.checked;
}

/**
 * @param {HTMLElement} button
 * @param {[string, string, string]} labels
 * @param {() => Promise} action
 */
function setupThreeStateButton(button, labels, action) {
    labels = labels.slice();
    const originalColor = button.style.color;
    const originalTextDecoration = button.style.textDecoration;
    const originalCursor = button.style.cursor;
    const setText = idx => {
        button.innerText = labels[idx];
        if (idx == 0) {
            button.style.textDecoration = originalTextDecoration;
            button.style.color = originalColor;
            button.style.cursor = originalCursor;
        } else {
            button.style.color = "grey";
            button.style.textDecoration = "none";
            button.style.cursor = "default";
        }
    };
    button.onclick = async e => {
        e.preventDefault();
        setText(1);
        await action();
        await sleep(120);
        setText(2);
        setTimeout(() => setText(0), 700);
    };
    setText(0);
}

/**
 * @param {HTMLElement} root
 * @param {[string, HTMLElement][]} tabs
 * @param {string} activeColor
 * @param {(tabIdx: number) => Promise} action
 */
function setupTabs(root, tabs, activeColor) {
    clearChildren(root);
    let tabIdx = 0;
    const labels = tabs.map(t => t[0]);
    const tabElts = tabs.map(t => t[1]);
    const labelSpans = [];
    const refresh = () => {
        for (let i = 0; i < labelSpans.length; i++) {
            const labelSpan = labelSpans[i];
            if (i === tabIdx) {
                labelSpan.style.color = "grey";
                labelSpan.style.cursor = "default";
                tabElts[i].classList.add("x-tab-active");
            } else {
                labelSpan.style.color = activeColor;
                labelSpan.style.cursor = "pointer";
                tabElts[i].classList.remove("x-tab-active");
            }
        }
    };

    for (let i = 0; i < labels.length; i++) {
        const labelSpan = root.appendChild(document.createElement("span"));
        if (i !== labels.length - 1) {
            const brk = root.appendChild(document.createElement("span"));
            brk.innerText = " / ";
            brk.style.color = "grey";
        }
        labelSpan.innerText = labels[i];
        labelSpan.onclick = async e => {
            e.preventDefault();
            tabIdx = i;
            refresh();
        };
        labelSpans.push(labelSpan);
    }

    refresh(0);
}

// https://stackoverflow.com/questions/56393880
function setupColorSchemeWatcher(cb) {
    if (!window.matchMedia) {
        return false;
    }

    let isDark = false;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        isDark = true;
    }

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => {
        let newIsDark = !!event.matches;
        cb(newIsDark);
    });

    return isDark;
}

/** @param {number} ms */
async function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

/**
 * @param {() => boolean} action
 * @param {number} timeoutMs
 */
function pollWithTimeout(action, timeoutMs) {
    const start = new Date();
    return new Promise((resolve, reject) => {
        function checkAction() {
            let result = false;
            try {
                result = action();
            } catch (err) {
                console.warn("Got error while polling", err);
            }

            if (result) {
                resolve();
                return;
            }

            if (new Date() - start > timeoutMs) {
                reject(new Error("Timed out"));
            }

            setTimeout(checkAction, 250);
        }
        setTimeout(checkAction, 0);
    });
}

// https://stackoverflow.com/a/18650249
function blobToBase64(blob) {
    return new Promise((resolve, _) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

// https://stackoverflow.com/a/35373030
const measureText = (() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    return function measureText(text, fontSize, font) {
        context.font = fontSize + "px " + font;
        return context.measureText(text).width;
    };
})();

// https://stackoverflow.com/a/47355187
const standardizeColor = (() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    return function standardizeColor(str) {
        context.fillStyle = str;
        return context.fillStyle;
    };
})();

// https://stackoverflow.com/a/5438011
/** @returns {Promise<HTMLCanvasElement>} */
async function renderAsCanvas() {
    return new Promise(resolve => {
        const backgroundColor = parseStringOrDefault(
            _scheduledTimeline.config?.palette?.backgroundColor,
            "white",
        );
        const svg = renderTimeline(_scheduledTimeline);
        const width = svg.width.baseVal.value * 2;
        const height = svg.height.baseVal.value * 2;
        const paddingX = 0;
        const paddingY = 0;
        const svgAsXML = new XMLSerializer().serializeToString(svg); // TODO: is this redundant?

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const loader = new Image();
        loader.width = width;
        loader.height = height;
        canvas.width = width + 2 * paddingX;
        canvas.height = height + 2 * paddingY;

        loader.onload = () => {
            context.fillStyle = backgroundColor;
            context.fillRect(0, 0, width + 2 * paddingX, height + 2 * paddingY);
            context.drawImage(loader, paddingX, paddingY, width, height);
            resolve(canvas);
        };
        loader.src = "data:image/svg+xml," + encodeURIComponent(svgAsXML);
    });
}

/** @param {HTMLElement} elt */
function clearChildren(elt) {
    while (elt.firstChild) {
        elt.removeChild(elt.lastChild);
    }
}

// https://stackoverflow.com/a/15832662
function downloadUri(uri, name) {
    const link = document.createElement("a");
    link.download = name;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    delete link;
}

async function downloadPng() {
    try {
        const canvas = await renderAsCanvas();
        downloadUri(canvas.toDataURL(), `${_timeline.title}.timeline.${dateToIso(new Date())}.png`);
    } catch (err) {
        console.error("Failed to download PNG", err);
    }
}

// https://stackoverflow.com/a/59162806
async function copyPngToClipboard() {
    try {
        const blob = await renderAsCanvas().then(
            canvas => new Promise(resolve => canvas.toBlob(resolve)),
        );

        log("writing to clipboard...", blob);
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch (error) {
        console.error(error);
    }
}

// https://stackoverflow.com/a/65917124
/**
 * @param {string} url
 * @param {string} fontName
 */
function addStylesheetWithUrl(url, fontName) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.id = `font-${removeNonAlphanum(fontName)}`;
    document.getElementsByTagName("head")[0].appendChild(link);
}

/** @param {string} fontName */
function getGFontConsent(fontName) {
    if (window._hasGfontConsent === null) {
        const result = confirm(
            `To load Google Fonts, this page will trigger requests to the Google Fonts API containing the font names you type (e.g., "${fontName}"), your IP address, and other metadata your browser may decide to send. Continue?`,
        );
        window._hasGfontConsent = `${result}`;
        window.localStorage.setItem(GFONT_LOCAL_STORAGE_KEY, window._hasGfontConsent);
    }

    return window._hasGfontConsent === "true";
}

async function loadGoogleFont() {
    if (_fontToLoad === null || _triedFonts.has(_fontToLoad)) {
        _fontToLoad = null;
        if (_triedFonts.has(_fontToLoad)) {
            // rerender once more, this should fix a race condition
            // where canvas cannot estimate text size until font is loaded
            rerenderTimeline();
        }
        return;
    }
    _triedFonts.add(_fontToLoad);
    const fontName = _fontToLoad;
    _fontToLoad = null;

    const gfontConsent = getGFontConsent(fontName);
    if (gfontConsent === false) {
        log(`not loading font '${fontName}' - previously declined`);
        return false;
    } else if (gfontConsent === true) {
        log(`loading font '${fontName}' - previously consented`);
    }

    const url = `https://fonts.googleapis.com/css2?family=${fontName}`;
    try {
        const response = await fetch(url);
        if (response.status < 200 || response.status >= 400) {
            console.warn(`Font '${fontName}' does not exist`, response.status);
            return;
        }

        try {
            let text = await response.text();
            const replacements = await Promise.all(
                text
                    .split("\n")
                    .map(t => t.split(" src: url(")[1])
                    .filter(
                        url =>
                            url &&
                            url.startsWith &&
                            url.startsWith("https://") &&
                            url.endsWith(") format('woff2');"),
                    )
                    .map(raw => ({
                        url: raw.split(") format('woff2');")[0],
                        original: raw,
                    }))
                    .map(async ({ url, original }) => {
                        const blob = await fetch(url).then(r => (r.ok ? r.blob() : null));
                        const woff2b64 = blob ? await blobToBase64(blob) : null;
                        return { woff2b64, original };
                    }),
            );

            for (const { woff2b64, original } of replacements) {
                if (woff2b64) {
                    text = text.replace(original, woff2b64 + ");");
                }
            }

            _loadedWoff2s[fontName] = text;
            if (!_loadedGoogleFonts.includes(fontName)) {
                _loadedGoogleFonts.push(fontName);
            }
        } catch (e) {
            console.warn("Caught exception parsing woff2", fontName, e);
            // swallow because we can still render in browser
            addStylesheetWithUrl(url, fontName);
        }
    } catch (e) {
        console.warn("Caught exception loading font", fontName, e);
        return;
    }

    rerenderTimeline();
}

/** @param {string} fontName */
function triggerLoadGoogleFont(fontName) {
    if (!_triedFonts.has(fontName)) {
        _fontToLoad = fontName;
    }
}

function initializeGoogleFontsWorker() {
    async function tryLoadFont() {
        await loadGoogleFont(_fontToLoad);
        window.setTimeout(tryLoadFont, 1000);
    }
    window.setTimeout(tryLoadFont, 0);
}

/** @param {string} json */
function writeToLocalStorage(json) {
    if (isLocalStorageEnabled()) {
        window.localStorage.setItem(TIMELINE_LOCAL_STORAGE_KEY, json);
    }
    _lastKnownJson = json;
    _mutated = true;
}

/** @returns {[boolean, string?]} (exists, value) */
function readFromLocalStorage() {
    const json = window.localStorage.getItem(TIMELINE_LOCAL_STORAGE_KEY);
    if (json !== null) {
        _mutated = true;
    }
    return [json !== null, json];
}

function clearLocalStorage() {
    window.localStorage.removeItem(TIMELINE_LOCAL_STORAGE_KEY);
}

function initLocalStorage() {
    if (_lastKnownJson !== null) {
        writeToLocalStorage(_lastKnownJson);
    } else {
        writeToLocalStorage(stringifyJson(_timeline));
    }
}

/** @param {Date} date */
function dateToIso(date) {
    return date.toISOString().split("T")[0];
}

/** @param {number} days */
function addDays(date, days) {
    const ret = new Date(date);
    ret.setDate(ret.getDate() + days);
    return ret;
}

/** @param {number} hours */
function addHours(date, hours) {
    const ret = new Date(date);
    const ms = hours * 60 * 60 * 1000;
    ret.setTime(ret.getTime() + ms);
    return ret;
}

/**
 * @param {Date} date1
 * @param {Date} date2
 */
function diffDays(date1, date2) {
    return Math.ceil((date2 - date1) / MILLIS_PER_DAY);
}

/**
 * @param {Date} start
 * @param {Date} end
 */
function getDateRangeText(start, end) {
    const startText = start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
    if (end > start) {
        end = addDays(end, -1);
    }
    const endText = end.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
    if (startText === endText) {
        return startText;
    }
    return `${startText} - ${endText}`;
}

/** @param {string} str */
function removeNonAlphanum(str) {
    return str.replace(/[\W_]+/g, " ");
}

/**
 * @param {any} maybeInt
 * @param {number} defaultIfNotInt
 */
function parseNumberOrDefault(maybeInt, defaultIfNotInt) {
    if (typeof maybeInt === "number") {
        return maybeInt;
    }
    return defaultIfNotInt;
}

/**
 * @param {any} maybeString
 * @param {string} defaultIfNotString
 */
function parseStringOrDefault(maybeString, defaultIfNotString) {
    if (typeof maybeString === "string") {
        return maybeString;
    }
    return defaultIfNotString;
}

/**
 * @param {any} maybeBool
 * @param {boolean} defaultIfNotBool
 * @returns {boolean}
 */
function parseBoolOrDefault(maybeBool, defaultIfNotBool) {
    if (maybeBool === true || maybeBool === false) {
        return maybeBool;
    }
    return defaultIfNotBool;
}

/**
 * @param {any} maybeDateString
 * @param {Date} defaultIfNotDate
 */
function parseDateOrDefault(maybeDateString, defaultIfNotDate) {
    if (typeof maybeDateString === "string") {
        return new Date(maybeDateString);
    }

    return defaultIfNotDate;
}

/**
 * @typedef {[number, number, number]} RGBColor
 * @param {string | RGBColor} hex
 * @returns {RGBColor}
 */
function colorToRgb(hex) {
    if (hex && hex.length && hex.length === 3 && Number.isInteger(hex[0])) {
        // rgb
        return hex;
    }
    const color = standardizeColor(hex);
    if (!color || color.length !== 7) {
        console.warn("Failed to standardize color", hex, color);
        return undefined;
    }

    return [color.substring(1, 3), color.substring(3, 5), color.substring(5, 7)].map(c =>
        parseInt(c, 16),
    );
}

/** @param {RGBColor} rgb */
function rgbToColor(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** @param {RGBColor} rgb */
function rgbAndAToColor(rgb, a) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

/**
 * @param {string[]} gradient
 * @returns {[boolean, RGBColor?[]]}
 */
function parseGradient(gradient) {
    if (!gradient || gradient.length === 0) {
        gradient = [DEFAULT_COLOR];
    }

    const components = gradient.map(colorToRgb);
    return [true, components];
}

/**
 * @param {string} color
 * @returns {string?}
 */
function getStrokeHex(color, backgroundColor, strokeDarkness, strokeThresholdL1) {
    if (!doColorsHaveSufficientContrastForGraphics(color, backgroundColor, strokeThresholdL1)) {
        return getContrastingColor(color, strokeDarkness, strokeDarkness, backgroundColor);
    }
    return null;
}

/** @param {Swimlane} swimlane */
function getMask(swimlane) {
    return "url(#diagonal-stripe)";
}

/**
 * @param {(RGBColor | string)[]} components
 * @param {number} t truncated to [0, 1]
 * @returns {RGBColor}
 */
function interpolateColor(components, t) {
    components = components.map(colorToRgb);
    if (components.length <= 1) {
        return components[0];
    }
    t = Math.max(0, Math.min(1, t));
    if (t === 1.0) {
        return components[components.length - 1];
    }
    const idx = Math.floor(t * (components.length - 1));
    const width = 1.0 / (components.length - 1);
    const [start, end] = [components[idx], components[idx + 1]];
    const t2 = (t - idx * width) / width;
    return [
        Math.max(0, Math.min(Math.round((1 - t2) * start[0] + t2 * end[0]), 255)),
        Math.max(0, Math.min(Math.round((1 - t2) * start[1] + t2 * end[1]), 255)),
        Math.max(0, Math.min(Math.round((1 - t2) * start[2] + t2 * end[2]), 255)),
    ];
}

function doColorsHaveSufficientContrastForGraphics(color1, color2, strokeThresholdL1) {
    const rgb1 = colorToRgb(color1);
    const rgb2 = colorToRgb(color2);
    // L1 metric IDK?
    const score =
        Math.abs(rgb1[0] - rgb2[0]) + Math.abs(rgb1[1] - rgb2[1]) + Math.abs(rgb1[2] - rgb2[2]);
    return score >= strokeThresholdL1;
}

/**
 * @param {RGBColor[]} components
 * @param {number} tBlack truncated to [0, 1]
 * @param {number} tWhite truncated to [0, 1]
 */
function getContrastingColor(color, tBlack, tWhite, background) {
    tBlack = Math.max(0, Math.min(1, tBlack));
    tWhite = Math.max(0, Math.min(1, tWhite));

    const rgb = colorToRgb(color);
    let shouldUseWhite = background
        ? sum(colorToRgb(background)) < sum(rgb)
        : rgb[0] + rgb[1] + rgb[2] < 255 * 1.6;
    if (shouldUseWhite) {
        return rgbToColor(interpolateColor([color, "white"], tWhite));
    }
    return rgbToColor(interpolateColor([color, "black"], tBlack));
}

/**
 * @param {number} lo
 * @param {number} hiExcl
 */
function randRange(lo, hiExcl) {
    return Math.floor(Math.random() * (hiExcl - lo) + lo);
}

/** @param {number[]} arr */
function sum(arr) {
    let ans = 0;
    for (const elt of arr) {
        ans += elt;
    }
    return ans;
}

/**
 * @template T
 * @param {T[]} arr
 */
function randChoice(arr) {
    return arr[randRange(0, arr.length)];
}

/**
 * @template T
 * @param {T[]} arr
 */
function uniq(arr) {
    return [...new Set(arr)];
}

function groupBy(arr, fn) {
    const result = {};
    for (const elt of arr) {
        const key = fn(elt);
        const group = result[key] || [];
        group.push(elt);
        result[key] = group;
    }
    return result;
}

/**
 * @param {typeof _timeline} timeline
 */
function assertTimelineValid(timeline) {
    for (const task of timeline.tasks) {
        if (task.interval.start > task.interval.end) {
            throw new Error(`Task '${task.id}' ('${task.name}') has start > end.`);
        }

        if (!timeline.swimlanes.some(swimlane => swimlane.id === task.swimlaneId)) {
            throw new Error(
                `Task '${task.id}' ('${task.name}') has invalid swimlane id ${task.swimlaneId}.`,
            );
        }
    }
}

function getSwimlaneIdToCanonicalIdx(timeline, errors = []) {
    const swimlaneIdToCanonicalIdx = {};
    for (let i = 0; i < timeline.swimlanes.length; i++) {
        let swimlaneIdx = i;
        let swimlane = timeline.swimlanes[swimlaneIdx];
        const originalId = swimlane.id;
        let n = 5;
        while (swimlane && swimlane.groupedWith !== undefined && n-- > 0) {
            swimlaneIdx = timeline.swimlanes.findIndex(s => s.id === swimlane.groupedWith);
            swimlane = timeline.swimlanes[swimlaneIdx];
        }

        if (!swimlane) {
            errors.push(`Cannot find swimlane for '${timeline.swimlanes[i]?.id}'`);
            swimlaneIdx = -1;
        } else if (swimlane.groupedWith !== undefined) {
            errors.push(
                `Cannot find swimlane: a groupedWith chain of length >= 5 was found for '${swimlane.id}'`,
            );
            swimlaneIdx = -1;
        }

        swimlaneIdToCanonicalIdx[originalId] = swimlaneIdx;
    }
    return swimlaneIdToCanonicalIdx;
}

// Approach discussed https://groups.google.com/g/d3-js/c/oVbg5HkAoH4?pli=1
// Code suggested there doesn't work anymore for d3v7
// This is an alternative implementation.
function cullOverlappingTickLabels(xAxisTicks, font, minAxisPadding) {
    try {
        const labelTextSize = 9;
        const getXAndRadius = c => {
            const cText = c.textContent;
            const cTransform = c.attributes.transform.value; // of the form "translate(x, y)"
            const [_, x, y] = [
                ...cTransform.matchAll("translate\\(\\s*([^,]+)\\s*,\\s*([^,]+)\\s*\\)"),
            ][0].map(parseFloat);
            const width = measureText(cText, labelTextSize, font);
            return [x, width / 2];
        };

        const overlaps = (curr, adjacent) => {
            const [cx, cr] = getXAndRadius(curr);
            let [nx, nr] = getXAndRadius(adjacent);
            return cx + cr + minAxisPadding > nx - nr;
        };

        const toRemove = [];
        let n = 1;
        for (n = 1; n < 10; n++) {
            let worked = true;
            for (let i = 0; i < xAxisTicks.length - n; i += n) {
                const curr = xAxisTicks[i];
                let adjacent = xAxisTicks[i + n];
                if (overlaps(curr, adjacent)) {
                    worked = false;
                    break;
                }
            }
            if (worked) {
                break;
            }
        }
        for (let i = 0; i < xAxisTicks.length; i++) {
            if (i % n !== 0) {
                toRemove.push(xAxisTicks[i]);
            }
        }

        for (const elt of toRemove) {
            d3.select(elt).remove();
        }
    } catch (err) {
        console.warn("Could not cull overlapping date labels", err);
    }
}

/**
 * @param {Timeline} rawTimeline
 * @returns {SVGElement}
 */
function renderTimeline(rawTimeline) {
    assertTimelineValid(rawTimeline);

    const shouldDrawGap = rawTimeline.config?.showDeps || rawTimeline.config?.showCriticalPaths;
    const scheduledTasks = rawTimeline.tasks
        .filter(t =>
            (rawTimeline.swimlanes || [])
                .filter(s => s.id === t.swimlaneId)
                .some(s => s.hidden !== true),
        )
        .map(t => ({
            ...t,
            interval: {
                start: new Date(t.interval.start),
                end: new Date(t.interval.end),
                drawnStart: addHours(new Date(t.interval.start), 0),
                drawnEnd: addHours(new Date(t.interval.end), shouldDrawGap ? -6 : 0),
            },
            offset: { center: 0, start: 0, end: 0 },
            _type: "task",
        }))
        .sort((a, b) => {
            const diff = a.interval.start.getTime() - b.interval.start.getTime();
            if (diff != 0) {
                return diff;
            }
            return a.interval.end.getTime() - b.interval.end.getTime();
        });
    const rawMilestones = rawTimeline.milestones || [];
    const minTaskDate = scheduledTasks
        .map(task => task.interval.start)
        .concat(
            rawMilestones.filter(m => m.interval?.exactly).map(m => new Date(m.interval.exactly)),
        )
        .reduce((min, curr) => (!min || curr < min ? curr : min), JS_MAX_DATE);
    let maxTaskDate = scheduledTasks
        .map(task => task.interval.end)
        .concat(
            rawMilestones.filter(m => m.interval?.exactly).map(m => new Date(m.interval.exactly)),
        )
        .reduce((max, curr) => (!max || curr > max ? curr : max), JS_MIN_DATE);
    if (minTaskDate > maxTaskDate) {
        maxTaskDate = addDays(minTaskDate, 1);
    }

    const taskHeight = parseNumberOrDefault(rawTimeline.config?.padding?.taskHeight, 15);
    const milestoneRadius = taskHeight / 2;

    const timeline = {
        ...rawTimeline,
        tasks: scheduledTasks,
        swimlanes: (rawTimeline.swimlanes || []).filter(swimlane => swimlane.hidden !== true),
        milestones: (rawTimeline.milestones || [])
            .filter(milestone => milestone.hidden !== true)
            .map(m => ({
                ...m,
                deps: m.deps || [],
                _type: "milestone",
            }))
            .map(m => {
                const exactly = m.interval?.exactly ? new Date(m.interval?.exactly) : null;
                const deps = m.deps
                    .map(depName => scheduledTasks.find(t => t.name === depName))
                    .filter(t => !!t);
                const milestoneTime = deps
                    .map(t => t.interval.end)
                    .reduce((max, end) => (end > max ? end : max), minTaskDate);
                const completed = deps.length > 0 && deps.every(d => d.completed);
                return {
                    ...m,
                    interval: {
                        start: exactly ?? milestoneTime,
                        end: exactly ?? milestoneTime,
                        drawnStart: exactly ?? milestoneTime,
                        drawnEnd: exactly ?? milestoneTime,
                    },
                    offset: {
                        start: milestoneRadius - 1,
                        // 1 to fix optical illusion involving line drawn into a circle's center.
                        // Where it is also occluded by the circle.
                        center: 1,
                        end: milestoneRadius - 1,
                    },
                    completed: m.completed ?? completed,
                };
            }),
        config: rawTimeline.config || {},
    };
    const anyGlobalMilestones = timeline.milestones.some(m => !m.swimlaneId);
    if (anyGlobalMilestones) {
        timeline.swimlanes = [
            {
                name: "",
                isMilestoneVirtualSwimlane: true,
                id: VIRTUAL_SWIMLANE_ID,
            },
            ...timeline.swimlanes,
        ];
        timeline.milestones
            .filter(m => !m.swimlaneId)
            .forEach(m => {
                m.swimlaneId = VIRTUAL_SWIMLANE_ID;
            });
    }
    const swimlanesWithMilestones = uniq(
        timeline.milestones.map(m => m.swimlaneId).filter(s => !!s),
    );
    /** @param {Swimlane} s */
    const getSwimlaneNameRows = s => s.name.split("\n").map(l => l.trim());

    let font = parseStringOrDefault(timeline.config.font, null);
    const googleFont = parseStringOrDefault(timeline.config.googleFont, null);

    if (googleFont !== null) {
        triggerLoadGoogleFont(googleFont);
        font = googleFont;
    }
    const woff2Stylesheet = googleFont ? _loadedWoff2s[googleFont] : null;

    if (font === null) {
        font = DEFAULT_FONT;
    }
    // if not a <generic-name>, encode as CSS <family-name> by quoting.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/font-family#family-name
    font = _cssFontGenericNames.includes(font.toLocaleLowerCase()) ? font : `"${font}"`;

    const width = parseNumberOrDefault(timeline.config.width, DEFAULT_WIDTH);
    const dateLabels = parseBoolOrDefault(timeline.config.dateLabels, DEFAULT_USE_DATE_LABELS);
    const [hasGradient, gradientComponents] = parseGradient(timeline.config.palette?.gradient);
    const maskSize = parseNumberOrDefault(timeline.config.palette?.stripes?.size, MASK_SIZE);
    const maskStrength = parseNumberOrDefault(
        timeline.config.palette?.stripes?.strength,
        MASK_STRENGTH,
    );
    const useMask = !!timeline.config.palette?.stripes;
    const strokeThresholdL1 = parseNumberOrDefault(
        timeline.config.palette?.outlines?.thresholdL1,
        STROKE_THRESHOLD,
    );
    const strokeDarkness = parseNumberOrDefault(
        timeline.config.palette?.outlines?.strength,
        STROKE_DARKNESS,
    );
    const textLabelOpacity = parseNumberOrDefault(
        timeline.config.palette?.textLabelOpacity,
        TEXT_LABEL_OPACITY,
    );
    const taskNameLabelTextSize = parseNumberOrDefault(timeline.config.fontSizes?.taskNames, 12);
    const taskDateLabelTextSize = parseNumberOrDefault(timeline.config.fontSizes?.taskDates, 10);
    const scaleLabelTextSize = parseNumberOrDefault(timeline.config.fontSizes?.scaleLabels, 10);
    const titleTextSize = timeline.title
        ? parseNumberOrDefault(timeline.config.fontSizes?.title, 20)
        : 0;

    const textPadding = 6;
    const dateScalePaddingX = 20;
    const labelPadding = 12;
    const dateRangePadding = 6;
    const completedTaskPadding = 4;
    const completedEmojiFontSize = taskHeight * 0.6;
    const emojiSize = measureText(COMPLETED_EMOJI, completedEmojiFontSize, font);
    const taskPadding = parseNumberOrDefault(timeline.config.padding?.tasks, 5);
    const textLineHeight = parseNumberOrDefault(timeline.config.padding?.textLineHeight, 1);
    const scaleLabelPadding = parseNumberOrDefault(timeline.config.padding?.scaleLabels, 5);
    const swimlanePadding = parseNumberOrDefault(timeline.config.padding?.swimlanes, 5);
    const useNice = parseBoolOrDefault(timeline.config.padding?.niceDateScale, false);
    const dateScalePaddingPercent =
        parseNumberOrDefault(timeline.config.padding?.dateScale, 5) * 0.01;
    const dateScalePaddingPercentLeft =
        parseNumberOrDefault(
            timeline.config.padding?.dateScaleLeft,
            dateScalePaddingPercent * 100,
        ) * 0.01;
    const dateScalePaddingPercentRight =
        parseNumberOrDefault(
            timeline.config.padding?.dateScaleRight,
            dateScalePaddingPercent * 100,
        ) * 0.01;
    const chartPaddingX = parseNumberOrDefault(
        timeline.config.padding?.chartX,
        DEFAULT_PADDING_CHARTX,
    );
    const chartPaddingY = parseNumberOrDefault(
        timeline.config.padding?.chartY,
        DEFAULT_PADDING_CHARTY,
    );
    const cullTicks = parseBoolOrDefault(timeline.config.padding?.cullOverlappingTicks, true);
    const swimlaneLabelPadding = 5;
    const completedTaskColor = parseStringOrDefault(
        timeline.config.palette?.completedTaskColor,
        null,
    );
    const backgroundColor = parseStringOrDefault(timeline.config.palette?.backgroundColor, "white");
    const defaultGridColor = getContrastingColor(backgroundColor, 0.1, 0.1);
    const xAxisGridColor = parseStringOrDefault(
        timeline.config.palette?.gridColor,
        defaultGridColor,
    );
    const taskLabelTextColor = getContrastingColor(backgroundColor, 0.9, 0.9);
    const titleTextColor = taskLabelTextColor;
    const taskDateLabelTextColor = getContrastingColor(backgroundColor, 0.55, 0.6);
    const xAxisGridTicks = parseNumberOrDefault(timeline.config.gridTicks, DEFAULT_GRID_TICKS);
    const titlePaddingTop = timeline.title ? 8 : 0;
    const titlePaddingBottom = timeline.title ? 18 : 0;
    const maxSwimlaneLabelWidth = timeline.swimlanes
        .flatMap(getSwimlaneNameRows)
        .reduce(
            (max, currLabel) => Math.max(measureText(currLabel, taskNameLabelTextSize, font), max),
            0,
        );
    const chartMarginTop =
        20 + titleTextSize + titlePaddingTop + titlePaddingBottom + chartPaddingY;
    let chartMarginLeft = Math.max(100, maxSwimlaneLabelWidth + labelPadding * 2);
    const scaleMarginTop = 5;
    const height =
        chartMarginTop +
        scaleMarginTop +
        (timeline.tasks.length + swimlanesWithMilestones.length) * (taskHeight + taskPadding) +
        timeline.swimlanes.length * swimlanePadding +
        2 * chartPaddingY;

    const taskSpanDays = diffDays(minTaskDate, maxTaskDate);
    const dateScalePaddingDaysLeft = Math.ceil(taskSpanDays * dateScalePaddingPercentLeft);
    const dateScalePaddingDaysRight = Math.ceil(taskSpanDays * dateScalePaddingPercentRight);
    let minScaleDate = minTaskDate;
    let maxScaleDate = maxTaskDate;
    const chartMarginRight = 0;

    const scaleWidth = width - chartMarginRight + chartPaddingX - (chartMarginLeft + chartPaddingX);

    // fixed point iteration for self-referential calculation
    const numIters = 10;
    for (let iter = 0; iter < numIters; iter++) {
        [minScaleDate, maxScaleDate] = [...timeline.tasks, ...timeline.milestones]
            .map(curr => {
                const percentL =
                    (curr.interval.start - minScaleDate) / (maxScaleDate - minScaleDate);
                const percentR = (curr.interval.end - minScaleDate) / (maxScaleDate - minScaleDate);
                const leftEdge = scaleWidth * percentL;
                const rightEdge = scaleWidth * percentR;

                const nameSize = measureText(curr.name, taskNameLabelTextSize, font);
                const dateRangeText = getDateRangeText(curr.interval.start, curr.interval.end);
                const dateRangeSize = measureText(dateRangeText, taskDateLabelTextSize, font);
                const rhsOverflow =
                    rightEdge +
                    textPadding +
                    curr.offset.end +
                    nameSize -
                    chartPaddingX -
                    scaleWidth;
                const lhsOverflow = leftEdge - dateRangeSize - curr.offset.start - dateRangePadding;

                const pixelsToDays = (maxScaleDate - minScaleDate) / MILLIS_PER_DAY / scaleWidth;
                const lhsOverflowDays = pixelsToDays * lhsOverflow;
                const rhsOverflowDays = pixelsToDays * rhsOverflow;
                const newMinScaleDate = addDays(minScaleDate, Math.floor(lhsOverflowDays));
                const newMaxScaleDate = addDays(maxScaleDate, Math.ceil(rhsOverflowDays));
                return [newMinScaleDate, newMaxScaleDate];
            })
            .reduce(
                ([minl, maxr], [currl, currr]) => [
                    currl < minl ? currl : minl,
                    currr > maxr ? currr : maxr,
                ],
                [minTaskDate, maxTaskDate],
            );
    }

    minScaleDate = addDays(minScaleDate, -Math.ceil(dateScalePaddingDaysLeft));
    maxScaleDate = addDays(maxScaleDate, Math.ceil(dateScalePaddingDaysRight));

    let cumulativeTaskIndex = 0;
    let tasksWithGradientIndex = 0;
    let numTasksWithGradient = timeline.swimlanes.filter(
        s => !s.color && !s.isMilestoneVirtualSwimlane,
    ).length;
    const perSwimlaneTasks = timeline.swimlanes
        .map((swimlane, swimlaneIndex, allSwimlanes) => {
            let colorToUse = swimlane.color;
            if (!colorToUse && hasGradient) {
                let t = 0.0;
                if (numTasksWithGradient > 1) {
                    t = (tasksWithGradientIndex * 1.0) / (numTasksWithGradient - 1.0);
                }
                const rgb = interpolateColor(gradientComponents, t);
                colorToUse = rgbToColor(rgb);
                if (!swimlane.isMilestoneVirtualSwimlane) {
                    tasksWithGradientIndex += 1;
                }
            }

            return {
                ...swimlane,
                color: colorToUse,
            };
        })
        .map((swimlane, swimlaneIndex) => {
            const milestones = timeline.milestones
                .filter(milestone => milestone.swimlaneId === swimlane.id)
                .map(milestone => ({
                    ...milestone,
                    swimlane,
                    swimlaneIndex,
                    taskIndexOverall: cumulativeTaskIndex,
                }));
            const isMilestone = milestones.length > 0;

            const tasks = timeline.tasks
                .filter(task => task.swimlaneId === swimlane.id)
                .map((task, taskIndexInSwimlane) => ({
                    ...task,
                    swimlane,
                    swimlaneIndex,
                    taskIndexInSwimlane,
                    taskIndexOverall:
                        taskIndexInSwimlane + cumulativeTaskIndex + (isMilestone ? 1 : 0),
                }));

            const heightInTasks = tasks.length + (isMilestone ? 1 : 0);
            const swimlaneWithCount = {
                ...swimlane,
                swimlaneIndex,
                taskIndexOverall: cumulativeTaskIndex,
                numTasks: heightInTasks,
            };
            cumulativeTaskIndex += heightInTasks;

            return { tasks, milestones, swimlane: swimlaneWithCount };
        });

    const svg = d3
        .create("svg")
        .attr("width", width + chartPaddingX * 2 + dateScalePaddingX)
        .attr("height", height)
        .attr("font-family", font)
        .style("background", backgroundColor);

    const defs = svg.append("defs");
    /**
     * @license
     * https://github.com/iros/patternfills/blob/master/public/sample_svg.html
     * The MIT License (MIT)
     *
     * Copyright (c) 2014 Irene Ros
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    const patterns = [
        '<mask id="diagonal-stripe" width="10" height="10"> <rect x="0" y="0" width="10000" height="10000" fill="url(#diagonal-stripe-pattern)" /> </mask>',
        `<pattern id="diagonal-stripe-pattern" patternUnits="userSpaceOnUse" width="${maskSize}" height="${maskSize}"> <image xlink:href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxMCcgaGVpZ2h0PScxMCc+CiAgPHJlY3Qgd2lkdGg9JzEwJyBoZWlnaHQ9JzEwJyBmaWxsPSdibGFjaycvPgogIDxwYXRoIGQ9J00tMSwxIGwyLC0yCiAgICAgICAgICAgTTAsMTAgbDEwLC0xMAogICAgICAgICAgIE05LDExIGwyLC0yJyBzdHJva2U9J3doaXRlJyBzdHJva2Utd2lkdGg9JzEnLz4KPC9zdmc+" x="0" y="0" width="${maskSize}" height="${maskSize}"> </image> </pattern>`,
    ];
    const rgb = colorToRgb(backgroundColor);
    const filters = [
        // https://stackoverflow.com/a/31013492
        `
<filter x="0" y="0" width="1" height="1" id="filter-bgcolor">
    <feFlood flood-color="${rgbAndAToColor(rgb, textLabelOpacity)}" result="bg" />
    <feMerge>
        <feMergeNode in="bg"/>
        <feMergeNode in="SourceGraphic"/>
    </feMerge>
</filter>`,
    ];
    defs.html(patterns.concat(filters).join("\n"));

    if (woff2Stylesheet) {
        svg.append("style").html(woff2Stylesheet);
    }

    if (timeline.title) {
        const title = svg
            .append("text")
            .text(timeline.title)
            .attr("x", width / 2 + chartPaddingX + dateScalePaddingX / 2)
            .attr("y", titleTextSize + titlePaddingTop + chartPaddingY)
            .attr("font-size", titleTextSize)
            .attr("fill", titleTextColor)
            .attr("font-family", font)
            .attr("text-anchor", "middle");
    }

    let dateScale = d3
        .scaleUtc()
        .domain([minScaleDate, maxScaleDate])
        .range([chartMarginLeft + chartPaddingX, width - chartMarginRight + chartPaddingX]);

    if (useNice) {
        dateScale = dateScale.nice(xAxisGridTicks);
    }

    const xAxisTickList = dateScale.ticks(xAxisGridTicks);
    const xAxisGrid = svg
        .selectAll("line.horizontalGrid")
        .data(xAxisTickList)
        .enter()
        .append("line")
        .attr("x1", d => dateScale(d))
        .attr("x2", d => dateScale(d))
        .attr("y1", chartMarginTop)
        .attr("y2", height - 2 * chartPaddingY - swimlaneLabelPadding)
        .attr("stroke", xAxisGridColor);

    const xAxis = d3.axisTop(dateScale);
    const xAxisTicks = svg
        .append("g")
        .attr("transform", `translate(0, ${chartMarginTop})`)
        .call(xAxis.ticks(xAxisGridTicks))
        .attr("font-family", font)
        .attr("font-size", scaleLabelTextSize)
        .attr("color", titleTextColor)
        .selectAll(".tick");

    if (cullTicks) {
        cullOverlappingTickLabels([...xAxisTicks], font, scaleLabelPadding);
    }

    const getTaskFill = d => {
        let fillColor = d.color ?? d.swimlane.color;
        if (d.completed) {
            fillColor = completedTaskColor ?? getContrastingColor(fillColor, 0.4, 0.5);
        }
        return fillColor;
    };

    const getStrokeHexForTask = d =>
        getStrokeHex(getTaskFill(d), backgroundColor, strokeDarkness, strokeThresholdL1);

    const getTaskY = d =>
        chartMarginTop +
        scaleMarginTop +
        (taskHeight + taskPadding) * d.taskIndexOverall +
        swimlanePadding * d.swimlaneIndex +
        swimlanePadding / 2 +
        (getStrokeHexForTask(d) ? 0.5 : 0);

    if (timeline.config.showDeps || timeline.config.showCriticalPaths) {
        const getTaskYForDep = t => getTaskY(t) + taskHeight / 2;

        const { showDeps, showCriticalPaths } = timeline.config;
        const dateScaleDuration = maxScaleDate - minScaleDate;
        const depColor = "grey";
        const getDepOpacityAndColor = ([d0, d1]) => {
            const diff = d1.interval.start - d0.interval.end;
            const isCriticalPath = diff <= MILLIS_PER_DAY;
            if (showCriticalPaths && isCriticalPath) {
                const gradientId = "g" + Math.random().toString().split(".")[1];
                const gradient = svg
                    .append("linearGradient")
                    .attr("id", gradientId)
                    .attr("gradientUnits", "userSpaceOnUse")
                    .attr("x1", dateScale(d0.interval.drawnEnd) + d0.offset.center)
                    .attr("y1", getTaskYForDep(d0))
                    .attr("x2", dateScale(d1.interval.drawnStart) - d1.offset.center)
                    .attr("y2", getTaskYForDep(d1));
                const startColor = getStrokeHexForTask(d0) ?? getTaskFill(d0);
                const endColor = getStrokeHexForTask(d1) ?? getTaskFill(d1);
                gradient.append("stop").attr("offset", "0%").attr("stop-color", startColor);
                gradient.append("stop").attr("offset", "100%").attr("stop-color", endColor);
                return { opacity: 0.8, color: `url(#${gradientId})`, width: 2 };
            }
            if (!showDeps) {
                return { opacity: 0.0, color: depColor, width: 0 };
            }
            if (!showCriticalPaths) {
                return { opacity: 1.0, color: depColor, width: 1 };
            }
            const closenessLinear = (d1.interval.start - d0.interval.end) / dateScaleDuration;
            const opacity = Math.max(0.5, Math.min(0.7, 0.5 - closenessLinear));
            return { opacity, color: depColor, width: 1 };
        };

        const allTasks = perSwimlaneTasks.flatMap(p => p.tasks);
        const allMilestones = perSwimlaneTasks.flatMap(p => p.milestones);
        const deps = [];

        const addDep = (depName, taskOrMilestone) => {
            const dep = allTasks.find(t => t.name === depName);
            const swimlane = timeline.swimlanes.find(t => t.id === depName);
            if (dep) {
                deps.push([dep, taskOrMilestone]);
            } else if (swimlane) {
                const swimlaneTask = allTasks
                    .filter(t => t.swimlaneId === swimlane.id)
                    .reduce((max, task) => (max.interval.end > task.interval.end ? max : task));
                deps.push([swimlaneTask, taskOrMilestone]);
            } else {
                log("Can't find dependency?", taskOrMilestone, allTasks);
            }
        };
        for (const task of allTasks) {
            for (const depName of task.deps || []) {
                addDep(depName, task);
            }
        }
        for (const milestone of allMilestones) {
            for (const depName of milestone.deps) {
                addDep(depName, milestone);
            }
        }

        const getX = d => ({
            x1:
                dateScale(d[0].interval.drawnEnd) +
                d[0].offset.center -
                (getStrokeHexForTask(d[0]) ? 0.5 : 1),
            x2:
                dateScale(d[1].interval.drawnStart) -
                d[1].offset.center +
                (getStrokeHexForTask(d[1]) ? 0.5 : 1),
        });

        const depLines = svg
            .selectAll("taskDep")
            .data(deps)
            .enter()
            .append("line")
            .attr("stroke-width", d => getDepOpacityAndColor(d).width)
            .attr("stroke", d => getDepOpacityAndColor(d).color)
            .attr("stroke-opacity", d => getDepOpacityAndColor(d).opacity)
            .attr("x1", d => getX(d).x1)
            .attr("x2", d => getX(d).x2)
            .attr("y1", d => getTaskYForDep(d[0]))
            .attr("y2", d => getTaskYForDep(d[1]));
    }

    for (const { tasks, milestones, swimlane } of perSwimlaneTasks) {
        const appendTaskRect = (enter, { mask }) => {
            let x = enter
                .append("rect")
                .datum(d => {
                    d.strokeHex = getStrokeHexForTask(d);
                    return d;
                })
                .attr("x", d => dateScale(d.interval.drawnStart))
                .attr("y", getTaskY)
                .attr(
                    "width",
                    d => dateScale(d.interval.drawnEnd) - dateScale(d.interval.drawnStart),
                )
                .attr("height", d => taskHeight - (d.strokeHex ? 0.5 : 0))
                .attr("fill", d => {
                    const fillColor = getTaskFill(d);
                    if (mask) {
                        return getContrastingColor(fillColor, maskStrength, maskStrength);
                    }
                    return fillColor;
                })
                .attr("stroke", d => d.strokeHex)
                .attr("stroke-width", d => (d.strokeHex ? 1 : 0));

            if (mask) {
                x.attr("mask", d => getMask(d.swimlane));
            }
        };

        const appendMilestone = (enter, { mask }) => {
            let x = enter
                .append("circle")
                .datum(d => {
                    d.strokeHex = getStrokeHexForTask(d);
                    return d;
                })
                .attr("cx", d => dateScale(d.interval.end))
                .attr("cy", d => getTaskY(d) + milestoneRadius)
                .attr("r", milestoneRadius)
                .attr("fill", d => {
                    const fillColor = getTaskFill(d);
                    if (mask) {
                        return getContrastingColor(fillColor, maskStrength, maskStrength);
                    }
                    return fillColor;
                })
                .attr("stroke", d => d.strokeHex)
                .attr("stroke-width", d => (d.strokeHex ? 1 : 0));

            if (mask) {
                x.attr("mask", d => getMask(d.swimlane));
            }
        };

        const rectEnter = svg.selectAll("taskbars").data(tasks).enter();

        appendTaskRect(rectEnter, { mask: false });
        if (useMask) {
            appendTaskRect(rectEnter, { mask: true });
        }

        if (milestones.length > 0) {
            const milestoneEnter = svg.selectAll("milestones").data(milestones).enter();
            appendMilestone(milestoneEnter, { mask: false });
            if (useMask) {
                appendMilestone(milestoneEnter, { mask: true });
            }
        }

        const basicTextAttributes = enter => {
            enter
                .attr("dominant-baseline", "middle") // https://stackoverflow.com/a/15997503
                .attr("font-family", font);
        };

        // TODO: split into multiple lines on overflow
        const taskTextLabels = svg
            .selectAll("tasktextlabels")
            .data([...tasks, ...milestones])
            .enter()
            .append("text")
            .attr("x", d => dateScale(d.interval.end) + d.offset.end)
            .attr("y", getTaskY)
            .attr("dx", textPadding)
            .attr("dy", d => taskHeight / 2 + RECT_TEXT_ALIGNMENT_OFFSET_HACK_PIXELS)
            .attr("font-size", taskNameLabelTextSize)
            .attr("text-anchor", "start")
            .attr("fill", taskLabelTextColor)
            .attr("filter", "url(#filter-bgcolor)")
            .text(d => d.name);

        basicTextAttributes(taskTextLabels);

        if (dateLabels) {
            // TODO: fix overflow into left margin
            const taskDateLabels = svg
                .selectAll("taskdatelabels")
                .data(tasks.concat(milestones))
                .enter()
                .append("text")
                .attr("x", d => dateScale(d.interval.start))
                .attr("y", getTaskY)
                .attr("dx", d => -dateRangePadding - d.offset.start)
                .attr("dy", d => taskHeight / 2 + RECT_TEXT_ALIGNMENT_OFFSET_HACK_PIXELS)
                .attr("fill", taskDateLabelTextColor)
                .attr("font-size", taskDateLabelTextSize)
                .attr("text-anchor", "end")
                .attr("filter", "url(#filter-bgcolor)")
                .text(d => getDateRangeText(d.interval.start, d.interval.end));

            basicTextAttributes(taskDateLabels);
        }

        const taskCompletionLabels = svg
            .selectAll("taskcompletionlabels")
            .data([...tasks, ...milestones])
            .enter()
            .append("text")
            .attr("font-size", completedEmojiFontSize)
            .attr("x", d => dateScale(d.interval.drawnEnd))
            .attr("y", getTaskY)
            .attr("dx", d =>
                d._type === "task" ? -completedTaskPadding - emojiSize : -emojiSize / 2,
            )
            .attr("dy", d => taskHeight / 2 + RECT_TEXT_ALIGNMENT_OFFSET_HACK_PIXELS + 0.5)
            .attr("opacity", d => (d.completed ? 1.0 : 0.0))
            .attr("fill", d => getContrastingColor(getTaskFill(d), 1.0, 1.0))
            .style("font-weight", "bold")
            .text(COMPLETED_EMOJI);
        basicTextAttributes(taskCompletionLabels);
    }

    const swimlaneOffset = swimlanePadding - swimlaneLabelPadding;
    const appendSwimlaneRect = (enter, mask) => {
        let x = enter
            .append("rect")
            .datum(d => {
                d.strokeHex = getStrokeHex(
                    d.color,
                    backgroundColor,
                    strokeDarkness,
                    strokeThresholdL1,
                );
                return d;
            })
            .attr("x", d => (d.strokeHex ? 0.5 : 0) + chartPaddingX)
            .attr("y", d => {
                return (
                    chartMarginTop +
                    scaleMarginTop +
                    (taskHeight + taskPadding) * d.taskIndexOverall +
                    swimlanePadding * d.swimlaneIndex
                );
            })
            .attr("width", d => chartMarginLeft - 5 - (d.strokeHex ? 1 : 0))
            .attr("height", d => (taskHeight + taskPadding) * d.numTasks + swimlaneOffset)
            .attr("stroke", d => d.strokeHex)
            .attr("stroke-width", d => (d.strokeHex ? 1 : 0))
            .attr("fill", d =>
                mask ? getContrastingColor(d.color, maskStrength, maskStrength) : d.color,
            );

        if (mask) {
            x.attr("mask", d => getMask(d));
        }
    };

    const swimlaneEnter = svg
        .selectAll("swimlanelabel")
        .data(perSwimlaneTasks.map(p => p.swimlane).filter(s => s.id !== VIRTUAL_SWIMLANE_ID))
        .enter();

    appendSwimlaneRect(swimlaneEnter, false);
    if (useMask) {
        appendSwimlaneRect(swimlaneEnter, true);
    }

    const swimlaneRectLabels = svg
        .selectAll("swimlanelabel")
        .data(
            perSwimlaneTasks.flatMap(p =>
                getSwimlaneNameRows(p.swimlane).map((row, rowIndex, rows) => ({
                    ...p.swimlane,
                    name: row,
                    rowIndex,
                    numRows: rows.length - 1,
                })),
            ),
        )
        .enter()
        .append("text")
        .text(d => d.name)
        .attr("x", chartMarginLeft / 2 - 2 + chartPaddingX)
        .attr(
            "y",
            d =>
                chartMarginTop +
                scaleMarginTop +
                (taskHeight + taskPadding) * d.taskIndexOverall +
                swimlanePadding * d.swimlaneIndex +
                textLineHeight * taskNameLabelTextSize * (d.rowIndex - d.numRows / 2),
        )
        .attr("dx", 0)
        .attr(
            "dy",
            d =>
                ((taskHeight + taskPadding) * d.numTasks) / 2 -
                taskPadding / 2 +
                taskNameLabelTextSize / 2 +
                swimlaneOffset / 2 +
                1,
        )
        .attr("font-size", taskNameLabelTextSize)
        .attr("height", d => (taskHeight + taskPadding) * d.numTasks)
        .attr("text-anchor", "middle")
        .attr("font-family", font)
        .attr("white-space", "normal")
        .attr("fill", d => getContrastingColor(d.color, 0.8, 1.0));

    return svg.node();
}

/**
 * @param {string} initialJson
 * @param {boolean} isDark
 * @param {(json: string) => { }} onAfterRender
 */
async function initializeMonacoEditorAsynchronously(initialJson, isDark, onAfterRender) {
    _timeline = parseJsoncUsingLib(initialJson);

    function getTheme(_isDark) {
        return _isDark ? "vs-dark" : "vs";
    }

    return new Promise(resolve => {
        // This `require` is provided by monaco-editor/min/vs/loader.js.
        require.config({ paths: { vs: "monaco-editor/min/vs" } });
        require(["vs/editor/editor.main"], async () => {
            const modelUri = monaco.Uri.parse(
                "https://garygurlaskie.com/gantt-chart-tool/internal.json",
            );
            const model = monaco.editor.createModel(initialJson, "json", modelUri);

            log("Loading JSON schema...");
            try {
                const jsonSchema = await fetch("schema.json").then(r => r.json());
                monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                    schemas: [
                        {
                            // Hardcode full path - I don't understand Monaco's behavior here
                            uri: "./schema.json",
                            fileMatch: [modelUri.toString()],
                            schema: jsonSchema,
                        },
                    ],
                });
                log("Loaded JSON schema.");
            } catch (e) {
                console.error("Failed to load JSON schema!", e);
            }
            const editor = monaco.editor.create(monacoContainer, {
                model: model,
                // https://stackoverflow.com/questions/47017753
                automaticLayout: true,
                theme: getTheme(isDark),
                minimap: { enabled: false },
            });
            _debugGlobalMonacoEditor = editor;
            window._debugGlobalMonacoEditor = editor;

            editor.getModel().onDidChangeContent(() => {
                const json = editor.getModel().createSnapshot().read();
                try {
                    _timeline = parseJsoncUsingLib(json);
                    rerenderTimeline();
                    onAfterRender(json);
                } catch (e) {
                    notifyFailed(e.message);
                }
            });

            const getText = () => editor.getModel().getValue();

            const overwriteText = textToWrite => {
                const model = editor.getModel();
                model.pushEditOperations(
                    [],
                    [
                        {
                            text: textToWrite,
                            range: model.getFullModelRange(),
                        },
                    ],
                    () => null,
                );
                // This saves the undo stack.
                // Without this, subsequent pushEditOperations calls will overwrite the stack.
                // https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.ITextModel.html#pushEditOperations.pushEditOperations-1
                model.pushStackElement();
            };

            const setTheme = newIsDark => {
                monaco.editor.setTheme(getTheme(newIsDark));
            };

            // Add custom JSON formatter
            // order is important - https://github.com/microsoft/monaco-editor/issues/3406
            monaco.languages.json.jsonDefaults.modeConfiguration.documentFormattingEdits = false;
            monaco.languages.registerDocumentFormattingEditProvider("json", {
                provideDocumentFormattingEdits(model, options, token) {
                    try {
                        return [
                            {
                                text: stringifyJson(JSON.parse(model.getValue())),
                                range: model.getFullModelRange(),
                            },
                        ];
                    } catch (err) {
                        console.warn("Invalid JSON, cannot format", err);
                        return [];
                    }
                },
            });

            resolve({ getText, overwriteText, setTheme });
        });
    });
}

function parseJsoncUsingLib(jsonc) {
    if (!window.parseJsonc) {
        console.warn("Couldn't find jsonc library?");
        return JSON.parse(jsonc);
    }
    return window.parseJsonc(jsonc);
}

/**
 * Parses an ISO8601 duration (or legacy duration).
 * @param {string} duration
 */
function parseDuration(duration) {
    duration = duration.trim().toLocaleUpperCase();
    // Legacy support for invalid durations
    const matches = [...duration.matchAll("PT([0-9]+)D")];
    if (matches.length == 1) {
        return parseInt(matches[0][1]);
    }

    const fail = () => {
        throw new Error("Invalid ISO8601 duration: " + duration);
    };

    const iso8601NumberChars = "012345678890,.".split("");
    const numbersOnly = "012345678890".split("");
    const separatorsOnly = ",.".split("");

    const parseIsoFloat = chars => {
        const components = [[]];
        for (const char of chars) {
            if (separatorsOnly.includes(char)) {
                components.push([]);
            } else if (numbersOnly.includes(char)) {
                components[components.length - 1].push(char);
            }
        }

        if (components.length >= 3) {
            fail();
        }

        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseFloat
        // Floats are not locale sensitive, and `.` is a valid separator in all locales.
        return Number.parseFloat(components.map(c => c.join("")).join("."));
    };

    // Actually implement spec - https://en.wikipedia.org/wiki/ISO_8601#Durations
    if (!duration.startsWith("P")) {
        fail();
    }
    const parts = [
        ["P", ["Y", "M", "W", "D"], "T"],
        ["T", ["H", "M", "S"], null],
    ];
    const partValuesInDays = {
        PY: 365,
        PM: 30,
        PW: 7,
        PD: 1,
        TH: 1.0 / 24.0,
        TM: 1.0 / 24.0 / 60.0,
        TS: 1.0 / 24.0 / 60.0 / 60.0,
    };
    let i = 0;
    components = {};
    for (const [partStart, subparts, nextPartStart] of parts) {
        if (i >= duration.length) {
            break;
        }
        if (duration.charAt(i) !== partStart) {
            continue;
        }

        i++;
        let subpartIdx = 0;
        while (subpartIdx < subparts.length && i < duration.length) {
            if (duration.charAt(i) === nextPartStart) {
                break;
            }
            const num = [];
            while (i < duration.length) {
                const char = duration.charAt(i);
                if (!iso8601NumberChars.includes(char)) {
                    break;
                }
                i++;
                num.push(char);
            }
            const value = parseIsoFloat(num);
            if (i >= duration.length || isNaN(value)) {
                fail();
            }

            let foundSubpart = false;
            while (subpartIdx < subparts.length) {
                const subpart = subparts[subpartIdx++];
                if (duration.charAt(i) === subpart) {
                    foundSubpart = true;
                    i++;

                    const key = `${partStart}${subpart}`;
                    if (components[key] !== undefined) {
                        fail();
                    }
                    components[key] = value;
                    break;
                }
            }
            if (!foundSubpart && duration.charAt(i) !== nextPartStart) {
                fail();
            }
        }
    }

    if (i < duration.length) {
        fail();
    }
    return Math.ceil(
        sum(Object.entries(components).map(([part, value]) => partValuesInDays[part] * value)),
    );
}

/**
 * @param {string} start
 * @param {string} end
 */
function getDuration(start, end) {
    return diffDays(new Date(start), new Date(end));
}

/** @param {number} length */
function zeroArray(length) {
    const arr = [];
    for (let i = 0; i < length; i++) {
        arr.push(0);
    }
    return arr;
}

function timer() {
    const t0 = new Date();
    return () => new Date() - t0;
}

/**
 * @param {typeof _timeline.tasks} tasks
 * @param {typeof _timeline.swimlanes} swimlanes
 */
function getCacheKey(tasks, swimlanes) {
    tasks = tasks.slice();
    swimlanes = swimlanes.slice();
    let nameIdx = 0;
    const taskNameToIdx = {};
    for (const task of tasks) {
        if (!taskNameToIdx[task.name]) {
            taskNameToIdx[task.name] = nameIdx++;
        }
    }

    const swimlaneNameToIdx = {};
    for (const swimlane of swimlanes) {
        if (!swimlaneNameToIdx[swimlane.id]) {
            swimlaneNameToIdx[swimlane.id] = nameIdx++;
        }
    }

    const taskKeys = tasks.map(task => {
        return {
            name: taskNameToIdx[task.name],
            deps: (task.deps || []).map(d => taskNameToIdx[d] || swimlaneNameToIdx[d]).sort(),
            fixedStartDateDays: task.fixedStartDateDays,
            fixedEndDateDays: task.fixedEndDateDays,
            durationDays: task.durationDays,
            swimlaneId: task.swimlaneId,
            width: task.width,
            importance: task.importance,
        };
    });

    const swimlaneKeys = swimlanes.map(s => {
        return {
            maxParallelism: s.maxParallelism || 1,
            groupedWith: s.groupedWith || "",
            id: s.id,
        };
    });

    return stringifyJson([taskKeys, swimlaneKeys]);
}

/** @param {number} ord */
function toEnUsOrd(ord) {
    if (!ord) {
        return ord;
    }
    if (ord % 10 === 1) {
        return `${ord}st`;
    } else if (ord % 10 === 2) {
        return `${ord}nd`;
    } else if (ord % 10 === 3) {
        return `${ord}rd`;
    }
    return `${ord}th`;
}

/**
 * @param {typeof _timeline} timeline
 * @returns {typeof _timeline}
 */
function validateTimeline(timeline) {
    /** @type {string[]} */
    const errors = [];
    const checkErrorsAndFail = () => {
        if (errors.length > 0) {
            throw new Error(errors.join("\n"));
        }
    };

    const taskNames = {};
    const swimlaneIds = {};

    const propsToStringCheck = [
        {
            label: "task",
            data: timeline.tasks || [],
            props: [{ prop: "name", unique: true, index: taskNames }],
            keys: ["name"],
        },
        {
            label: "swimlane",
            data: timeline.swimlanes || [],
            props: [
                { prop: "id", unique: true, index: swimlaneIds },
                { mutex: ["maxParallelism", "groupedWith"] },
            ],
            keys: ["name", "id"],
        },
        {
            label: "milestone",
            data: timeline.milestones || [],
            props: [{ prop: "name" }],
            keys: ["name"],
        },
    ];

    for (const { label, data, props, keys } of propsToStringCheck) {
        let ord = 1;
        for (const { prop, unique, index, mutex } of props) {
            for (const entry of data) {
                if (prop) {
                    if (!entry || !entry[prop]) {
                        errors.push(
                            `The ${toEnUsOrd(ord)} ${label} is missing a "${prop}" property.`,
                        );
                    }
                    const value = entry[prop];
                    if (unique && index && index[value]) {
                        errors.push(`Multiple ${label}s cannot have ${prop} '${value}'.`);
                    }
                    if (index) {
                        index[value] = entry;
                    }
                }
                if (mutex) {
                    const name = keys.map(key => entry[key]).find(x => x) || `<no '${key}'>`;
                    const numPresent = mutex.filter(k => entry.hasOwnProperty(k)).length;
                    if (numPresent > 1) {
                        errors.push(
                            `The ${label} '${name}' can only have one of ${mutex.join(", ")}`,
                        );
                    }
                }
                ord++;
            }
        }
    }

    getSwimlaneIdToCanonicalIdx(timeline, errors);
    checkErrorsAndFail();

    const dependenciesToValidate = [
        { label: "task", data: timeline.tasks || [], config: { allowEmptySwimlane: false } },
        {
            label: "milestone",
            data: timeline.milestones || [],
            config: { allowEmptySwimlane: true, checkMilestoneExactlyOrDeps: true },
        },
    ];
    for (const { data, label, config } of dependenciesToValidate) {
        for (const taskOrMilestone of data) {
            if (taskOrMilestone.deps) {
                if (!Array.isArray(taskOrMilestone.deps)) {
                    errors.push(`"deps" array is invalid for ${taskOrMilestone.name}.`);
                } else {
                    const notFoundDeps = taskOrMilestone.deps.filter(
                        d => !taskNames[d] && !swimlaneIds[d],
                    );
                    for (const d of notFoundDeps) {
                        errors.push(`Can't find dependency: ${d} for ${taskOrMilestone.name}.`);
                    }

                    if (taskOrMilestone.deps.some(d => d === taskOrMilestone.name)) {
                        errors.push(`${label} ${taskOrMilestone.name} can't depend on itself.`);
                    }

                    if (taskOrMilestone.deps.some(d => d === taskOrMilestone.swimlaneId)) {
                        errors.push(
                            `${label} ${taskOrMilestone.name} can't depend on its own swimlane.`,
                        );
                    }
                }
            }

            const invalidEmptySwimlane = !taskOrMilestone.swimlaneId && !config.allowEmptySwimlane;
            const invalidSwimlaneReference =
                !!taskOrMilestone.swimlaneId && !swimlaneIds[taskOrMilestone.swimlaneId];
            if (invalidEmptySwimlane || invalidSwimlaneReference) {
                errors.push(
                    `Can't find swimlane ${taskOrMilestone.swimlaneId || "<not provided>"} for ${label} ${taskOrMilestone.name}.`,
                );
            }

            if (config.checkMilestoneExactlyOrDeps) {
                if (
                    !taskOrMilestone.interval?.exactly &&
                    (!taskOrMilestone.deps || taskOrMilestone.deps.length === 0)
                ) {
                    errors.push(
                        `If dependency array is empty for ${label} ${taskOrMilestone.name}, ${label}.interval.exactly must be set.`,
                    );
                }
            }
        }
    }

    checkErrorsAndFail();

    // very naive cycle detection (N^4)
    for (const task of timeline.tasks || []) {
        const stack = [[task.name, []]];
        while (stack.length > 0) {
            const [curr, currBackEdges] = stack.pop();
            const currTask = taskNames[curr];
            let deps;
            if (currTask) {
                deps = currTask.deps;
            } else {
                const tasks = timeline.tasks.filter(t => t.swimlaneId === curr);
                deps = tasks.map(t => t.name);
            }

            for (const dep of deps || []) {
                const cycleIdx = currBackEdges.indexOf(dep);
                if (cycleIdx !== -1) {
                    errors.push(
                        `Cycle detected: ${currBackEdges.slice(cycleIdx).join(" -> ")} -> ${curr} -> ${dep}.`,
                    );
                    checkErrorsAndFail();
                }

                stack.push([dep, [...currBackEdges, curr]]);
            }
        }
    }
}

/**
 * @param {typeof _timeline} timeline
 * @returns {typeof _timeline}
 */
async function scheduleTasks(timeline, onSolvingStart) {
    if (_z3 === null) {
        const backoffs = [1000, 5000, 15000];
        for (const backoff of backoffs) {
            try {
                log("Attempting to load z3...");
                _z3 = await loadz3();
                _z3.setParam("memory_high_watermark_mb", Z3_MAX_MEMORY_MB);
            } catch (err) {
                log("Failed to load z3.");
                await sleep(backoff);
            }
        }
    }

    if (timeline.tasks.every(t => t.interval)) {
        return timeline;
    }

    const baseDate = parseDateOrDefault(
        timeline.config?.startDate,
        new Date(dateToIso(new Date())),
    );
    const tasks = timeline.tasks
        .map(t => ({
            ...t,
            interval: t.interval ?? t.scheduledInterval,
        }))
        .map((t, i) => ({
            ...t,
            durationDays: t.duration
                ? parseDuration(t.duration)
                : getDuration(t.interval.start, t.interval.end),
            fixedStartDateDays: t.interval ? diffDays(baseDate, new Date(t.interval.start)) : null,
            fixedEndDateDays: t.interval ? diffDays(baseDate, new Date(t.interval.end)) : null,
            globalIndex: i,
        }));

    validateTimeline(timeline);

    function buildSolver() {
        // Modified version the constraint formulation of Job-Shop found in
        // https://smt.st/SAT_SMT_by_example.pdf (Chapter 22.8)
        // - binding/presence trick
        // - modified to work with DAG dependencies (instead of linear jobs)
        // - extended to handle "fixed" tasks (i.e., interruptions)
        const c = new _z3.Context("main");

        const solver = new c.Optimize();
        const lengthDays = c.Int.const("lengthDays");
        const sumDays = c.Int.const("sumDays");

        const errors = [];
        const checkErrors = () => {
            if (errors.length > 0) {
                throw new Error(errors.join("\n"));
            }
        };

        // these are evaluated lexicographically
        // https://microsoft.github.io/z3guide/docs/optimization/combiningobjectives
        solver.minimize(lengthDays); // primary: minimize end date of timeline
        solver.minimize(sumDays); // secondary: pick earliest start for each task

        const makeVar = (...args) => args.join("_");
        const getTaskIdx = name => tasks.findIndex(t => t.name === name);
        const noOverlap = ([start1, end1], [start2, end2]) =>
            c.Or(c.GE(start1, end2), c.GE(start2, end1));

        const getSwimlaneIdx = task => getSwimlaneIdx1(task.swimlaneId);
        const getSwimlaneIdx1 = swimlaneId => swimlaneIdToCanonicalIdx[swimlaneId];
        const swimlaneIdToCanonicalIdx = getSwimlaneIdToCanonicalIdx(timeline, errors);
        const swimlaneIdToTasks = groupBy(timeline.tasks, task => task.swimlaneId);

        checkErrors();

        const ti_start = tasks.map((task, i) => c.Int.const(makeVar(task, i, "start")));
        const ti_end = tasks.map((task, i) => c.Int.const(makeVar(task, i, "end")));
        const til_present = timeline.swimlanes.map(s =>
            zeroArray(s.maxParallelism || 1).map(_ => ({})),
        );
        const til_start = timeline.swimlanes.map(s =>
            zeroArray(s.maxParallelism || 1).map(_ => ({})),
        );
        const til_end = timeline.swimlanes.map(s =>
            zeroArray(s.maxParallelism || 1).map(_ => ({})),
        );
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            if (task.fixedStartDateDays) {
                solver.add(
                    c.And(
                        c.Eq(ti_start[i], task.fixedStartDateDays),
                        c.Eq(ti_end[i], task.fixedEndDateDays),
                    ),
                );
            } else {
                solver.add(c.Eq(ti_start[i].add(task.durationDays), ti_end[i]));
                solver.add(c.GE(ti_start[i], 0));

                solver.add(c.LE(ti_end[i], lengthDays));
            }

            for (const d of task.deps || []) {
                const j = getTaskIdx(d);
                if (j !== -1) {
                    solver.add(c.GE(ti_start[i], ti_end[j]));
                } else if (swimlaneIdToTasks[d]) {
                    const depTasks = swimlaneIdToTasks[d];
                    for (const depTask of depTasks) {
                        const j = getTaskIdx(depTask.name);
                        if (j === -1) {
                            errors.push(
                                `Can't find task '${depTask.name}' of swimlane dependency '${d}'`,
                            );
                            continue;
                        }
                        solver.add(c.GE(ti_start[i], ti_end[j]));
                    }
                } else {
                    errors.push(`Can't find dependency: ${d} for ${task.name}`);
                }
            }

            const s = getSwimlaneIdx(task);
            if (s === -1) {
                errors.push(
                    `Can't find swimlane ${task.swimlaneId || "<not provided>"} for task ${task.name}`,
                );
                continue;
            }
            const swimlane = timeline.swimlanes[s];
            const presence = [];
            for (let l = 0; l < (swimlane.maxParallelism || 1); l++) {
                til_present[s][l][i] = c.Int.const(makeVar(task, i, l, "present"));
                solver.add(c.And(c.GE(til_present[s][l][i], 0), c.LE(til_present[s][l][i], 1)));
                til_start[s][l][i] = c.Int.const(makeVar(task, i, l, "start"));
                til_end[s][l][i] = c.Int.const(makeVar(task, i, l, "end"));

                solver.add(
                    c.Implies(c.Eq(til_present[s][l][i], 1), c.Eq(til_start[s][l][i], ti_start[i])),
                );
                solver.add(
                    c.Implies(c.Eq(til_present[s][l][i], 1), c.Eq(til_end[s][l][i], ti_end[i])),
                );

                presence.push(til_present[s][l][i]);
            }
            solver.add(c.Eq(c.Sum(...presence), task.width || 1));
        }

        const ti_end_wbias = ti_end.map((t, i) => t.mul(tasks[i].importance || 1));
        solver.add(c.Eq(c.Sum(...ti_end_wbias), sumDays));

        for (let s = 0; s < til_present.length; s++) {
            const sTasks = tasks.filter(task => getSwimlaneIdx(task) == s);
            for (const t1 of sTasks) {
                for (const t2 of sTasks) {
                    if (t1.globalIndex === t2.globalIndex) {
                        continue;
                    }

                    for (let l = 0; l < til_present[s].length; l++) {
                        const t_present = til_present[s][l];
                        const t_start = til_start[s][l];
                        const t_end = til_end[s][l];
                        solver.add(
                            c.Implies(
                                c.And(
                                    c.Eq(t_present[t1.globalIndex], 1),
                                    c.Eq(t_present[t2.globalIndex], 1),
                                ),
                                noOverlap(
                                    [t_start[t1.globalIndex], t_end[t1.globalIndex]],
                                    [t_start[t2.globalIndex], t_end[t2.globalIndex]],
                                ),
                            ),
                        );
                    }
                }
            }
        }

        checkErrors();

        return [solver, ti_start, ti_end];
    }

    function getOrBuildSolver(cacheKey, currAttemptTimeout) {
        const [solver, ti_start, ti_end] =
            cacheKey === _lastSolverCacheKey ? _lastSolverUsed : buildSolver();
        _lastSolverCacheKey = cacheKey;
        _lastSolverUsed = [solver, ti_start, ti_end];
        solver.set("timeout", currAttemptTimeout);

        return [..._lastSolverUsed];
    }

    async function solve() {
        const cacheKey = getCacheKey(tasks, timeline.swimlanes);
        let starts;
        let ends;
        if (!_solutionCache[cacheKey] || _solutionCache[cacheKey][2] !== null) {
            let oldStarts, oldEnds, currAttemptTimeout;
            if (_solutionCache[cacheKey]) {
                [oldStarts, oldEnds, currAttemptTimeout] = _solutionCache[cacheKey];
            }
            if (!currAttemptTimeout) {
                currAttemptTimeout = Z3_INITIAL_TIMEOUT_MS;
            }

            const logTime = timer();
            log("configuring solver...", logTime());
            const [solver, ti_start, ti_end] = getOrBuildSolver(cacheKey, currAttemptTimeout);
            log("configured solver.", logTime(), currAttemptTimeout);

            log("running solver...", logTime());
            onSolvingStart(currAttemptTimeout);
            const result = await solver.check();

            log(result, logTime());
            if (result == "unsat") {
                throw new Error("Unsatisfiable constraints");
            }

            const model = solver.model();
            starts = ti_start.map(x => model.eval(x).value()).map(Number);
            ends = ti_end.map(x => model.eval(x).value()).map(Number);

            log(starts, ends);

            // If model is not optimized, trigger a retry with 3x timeout
            // This repeats at most 1/3 of the work each iteration, which is good enough.
            let nextAttemptTimeout = null;
            if (result == "unknown" && currAttemptTimeout < Z3_MAX_TIMEOUT_MS) {
                nextAttemptTimeout = Math.min(
                    Math.floor(currAttemptTimeout * Z3_TIMEOUT_GROWTH_RATE),
                    Z3_MAX_TIMEOUT_MS,
                );
                _renderNeeded = true;

                // if partial solution is not more optimal than the previous one
                if (oldEnds && Math.max(...oldEnds) < Math.max(...ends)) {
                    starts = oldStarts;
                    ends = oldEnds;
                }
            }
            _solutionCache[cacheKey] = [starts, ends, nextAttemptTimeout];
        } else {
            [starts, ends] = _solutionCache[cacheKey];
        }

        return {
            ...timeline,
            tasks: timeline.tasks.map((t, i) => ({
                ...t,
                interval: {
                    start: addDays(baseDate, starts[i]),
                    end: addDays(baseDate, ends[i]),
                },
            })),
        };
    }

    return await solve();
}

async function hackReloadWindowIfNeeded() {
    // last resort, and doesn't always work
    // hack to reload page if SAB is `undefined` and coepWorker hasn't reloaded the page.
    // TODO: fix coepWorker so this is not required.
    const sab = typeof SharedArrayBuffer === "undefined";
    const reload = window.sessionStorage.getItem("lastResortReload");
    if (sab && (reload === null || new Date().getTime() - parseInt(reload) > 15000)) {
        log("Reloading...");
        window.sessionStorage.setItem("lastResortReload", new Date().getTime());
        window.location.reload();
    }
}

function rerenderTimeline() {
    _renderNeeded = true;
}

async function flushTimeline() {
    if (!_renderNeeded) {
        return;
    }
    _renderNeeded = false;

    await hackReloadWindowIfNeeded();

    try {
        notifyOptimizing();
        validateTimeline(_timeline);
        _scheduledTimeline = await scheduleTasks(_timeline, timeout =>
            notifyOptimizingWithTimeout(timeout),
        );

        notifyRendering();
        const svg = renderTimeline(_scheduledTimeline);
        clearChildren(container);
        container.append(svg);
        notifyRendered();
    } catch (e) {
        console.error("Building timeline failed", e);
        notifyFailed(e.message);
    }
}

function initializeTimelineWorker() {
    async function runFlushJob() {
        await flushTimeline();
        window.setTimeout(runFlushJob, 250);
    }
    window.setTimeout(runFlushJob, 0);
}

function setupPageLeavePrompt() {
    window.onbeforeunload = e => {
        const timelineHasUnsavedEdits = !readFromLocalStorage()[0] && _mutated;
        if (timelineHasUnsavedEdits) {
            e.preventDefault();
        }
    };
}

function writeRandomizedConfigToMonaco() {
    if (_overwriteText !== null && _scheduledTimeline !== null) {
        const makeHsl = (h, s, l) => `hsl(${h}, ${s}%, ${l}%)`;
        const colorOptions = {
            oneColor() {
                const h = randRange(0, 360);
                const s = randRange(0, 101);
                const l1 = randRange(0, 101);
                const l2 = randChoice(
                    [
                        l1 >= 30 ? randRange(0, l1 * 0.7 + 1) : null,
                        l1 <= 70 ? randRange(l1 * 1.2, 101) : null,
                    ].filter(a => a !== null),
                );

                return [
                    { path: ["palette", "gradient"], value: [makeHsl(h, s, l1)] },
                    { path: ["palette", "backgroundColor"], value: makeHsl(h, s, l2) },
                ];
            },
        };

        const editFn = randChoice([colorOptions.oneColor]);
        const edits = editFn();

        const text = _getText();
        const timelineToWrite = JSON.parse(text);

        for (const { path, value } of edits) {
            const objToMutate = path
                .slice(0, -1)
                .reduce((obj, p) => obj[p] || {}, timelineToWrite.config || {});
            objToMutate[path[path.length - 1]] = value;
        }

        const timelineJson = stringifyJson(timelineToWrite);
        _overwriteText(timelineJson);
        writeToLocalStorage(timelineJson);
    }
}

function writeOptimizedScheduleToMonaco() {
    if (
        _getText !== null &&
        _overwriteText !== null &&
        _scheduledTimeline !== null &&
        !!_scheduledTimeline.tasks
    ) {
        const text = _getText();
        const timelineToWrite = JSON.parse(text);
        (timelineToWrite.tasks || []).forEach(t => {
            const scheduledTask = _scheduledTimeline.tasks.find(stt => stt.name == t.name);
            if (scheduledTask?.interval && !t.interval) {
                t.scheduledInterval = {
                    start: dateToIso(scheduledTask.interval.start),
                    end: dateToIso(scheduledTask.interval.end),
                };
            }
        });
        const timelineJson = stringifyJson(timelineToWrite);
        _overwriteText(timelineJson);
        writeToLocalStorage(timelineJson);
    }
}

function log(...args) {
    console.log(...args);
}

async function main() {
    log("running script");

    const [exists, storedJson] = readFromLocalStorage();
    const jsonToUse = exists ? storedJson : stringifyJson(_timeline);
    const isDark = setupColorSchemeWatcher(isDark => {
        if (_setTheme) {
            _setTheme(isDark);
        }
    });
    initializeMonacoEditorAsynchronously(jsonToUse, isDark, renderedJson =>
        writeToLocalStorage(renderedJson),
    ).then(({ getText, overwriteText, setTheme }) => {
        _getText = getText;
        _overwriteText = overwriteText;
        _setTheme = setTheme;
    });
    initializeTimelineWorker();
    initializeGoogleFontsWorker();
    rerenderTimeline();
}

main();
