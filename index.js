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
const MASK_STRENGTH = 0.15;
const MASK_SIZE = 6;
const DEFAULT_GRID_TICKS = 20;
const LINK_COLOR = "#3c5ca2";
const DEFAULT_PADDING_TASKHEIGHT = 15;
const DEFAULT_PADDING_TASKS = 5;
const DEFAULT_PADDING_SWIMLANES = 5;
const DEFAULT_PADDING_CHARTX = 10;
const DEFAULT_PADDING_CHARTY = 5;
const DEFAULT_TASKNAMES_FONTSIZE = 12;
const DEFAULT_TASKDATES_FONTSIZE = 10;
const DEFAULT_TITLE_FONTSIZE = 22;
const START_DATE_ISO = dateToIso(new Date());
const Z3_MAX_MEMORY_MB = "512";
const Z3_TIMEOUT_GROWTH_RATE = 3;
const Z3_INITIAL_TIMEOUT_MS = 2000;
const Z3_MAX_TIMEOUT_MS = 180_000;

let _z3 = null;
let _debugGlobalMonacoEditor;
let _timeline = makeSampleTimeline();
let _fontToLoad = null;
let _lastKnownJson = null;
let _mutated = false;
var _randomTaskId = 1;
let _overwriteText = null;
let _setThemeCb = null;
let _renderNeeded = false;
let _scheduledTimeline = null;
let _hasGfontConsent = window.localStorage.getItem(GFONT_LOCAL_STORAGE_KEY);
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
    fixedIntervalsButton,
    ["Write Optimized Schedule", "...", "Written!"],
    writeOptimizedScheduleToMonaco,
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
    "Failed",
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
 * @typedef {Timeline['config'][0]} Config
 * @typedef {Timeline['tasks'][0]} Task
 */
function makeSampleTimeline() {
    return {
        title: "Project A",
        config: {
            width: 800,
            font: "sans-serif",
            startDate: START_DATE_ISO,
            dateLabels: true,
            showDeps: false,
            palette: {
                gradient: ["#3c5ca2", "seagreen", "#eee"],
                backgroundColor: "white",
                stripes: {
                    size: 6,
                    strength: 0.15,
                },
                outlines: {
                    thresholdL1: STROKE_THRESHOLD,
                    strength: STROKE_DARKNESS,
                },
            },
            padding: {
                tasks: DEFAULT_PADDING_TASKS,
                taskHeight: DEFAULT_PADDING_TASKHEIGHT,
                swimlanes: DEFAULT_PADDING_SWIMLANES,
                chartX: DEFAULT_PADDING_CHARTX,
                chartY: DEFAULT_PADDING_CHARTY,
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
            { id: "4", name: "D", maxParallelism: 1 },
            { id: "5", name: "E", maxParallelism: 2 },
        ],
        tasks: [
            ...makeRandomTaskDAG(["1", "1", "1", "2"], 4),
            ...makeRandomTaskDAG(["1", "2", "3", "4", "5"], 12),
            makeRandomFixedTask("Fixed Task A", "1"),
            makeRandomFixedTask("Fixed Task B", "2"),
        ],
    };
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

    return tasks;
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
 *
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
            button.style.textDecoration = "none";
            button.style.color = "grey";
            button.style.cursor = "default";
        }
    };
    button.onclick = async e => {
        e.preventDefault();
        setText(1);
        await action();
        await sleep(200);
        setText(2);
        setTimeout(() => setText(0), 1000);
    };
    setText(0);
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
            _scheduledTimeline.config.palette?.backgroundColor,
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
    const canvas = await renderAsCanvas();
    downloadUri(canvas.toDataURL(), `${_timeline.title}.timeline.${dateToIso(new Date())}.png`);
}

// https://stackoverflow.com/a/59162806
async function copyPngToClipboard() {
    const blob = await renderAsCanvas().then(
        canvas => new Promise(resolve => canvas.toBlob(resolve)),
    );

    try {
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
    if (_hasGfontConsent === null) {
        const result = confirm(
            `To load Google Fonts, this page will trigger requests to the Google Fonts API containing the font names you type (e.g., "${fontName}"). Continue?`,
        );
        _hasGfontConsent = `${result}`;
        window.localStorage.setItem(GFONT_LOCAL_STORAGE_KEY, _hasGfontConsent);
    }

    return _hasGfontConsent === "true";
}

async function loadGoogleFont() {
    if (_fontToLoad === null || _triedFonts.has(_fontToLoad)) {
        _fontToLoad = null;
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

/**
 * @param {Date} date1
 * @param {Date} date2
 */
function diffDays(date1, date2) {
    return Math.ceil((date2 - date1) / (1000 * 60 * 60 * 24));
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
    const endText = end.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
    if (startText === endText) {
        return start;
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
function parseIntOrDefault(maybeInt, defaultIfNotInt) {
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

/**
 * @param {string[]} gradient
 * @returns {[boolean, RGBColor?[]]}
 */
function parseGradient(gradient) {
    if (!gradient) {
        return [false, undefined, undefined];
    }

    const components = gradient.map(colorToRgb);
    return [components.length >= 1, components];
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

// Approach discussed https://groups.google.com/g/d3-js/c/oVbg5HkAoH4?pli=1
// Code suggested there doesn't work anymore for d3v7
// This is an alternative implementation.
function cullOverlappingTickLabels(xAxisTicks, font) {
    try {
        const minAxisPadding = 7;
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

        const toRemove = [];
        for (let i = 0; i < xAxisTicks.length - 1; i++) {
            const curr = xAxisTicks[i];
            let adjacent = xAxisTicks[i + 1];

            const [cx, cr] = getXAndRadius(curr);
            let [nx, nr] = getXAndRadius(adjacent);

            // walk forward until we find a tick that doesn't overlap
            while (cx + cr + minAxisPadding > nx - nr) {
                if (cr < nr) {
                    // of the ticks, keep the larger
                    toRemove.push(curr);
                    break;
                }
                toRemove.push(adjacent);
                i++;
                if (i >= xAxisTicks.length - 1) {
                    break;
                }
                adjacent = xAxisTicks[i + 1];
                [nx, nr] = getXAndRadius(adjacent);
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

    const timeline = {
        ...rawTimeline,
        tasks: rawTimeline.tasks
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
                },
            }))
            .sort((a, b) => {
                const diff = a.interval.start.getTime() - b.interval.start.getTime();
                if (diff != 0) {
                    return diff;
                }
                return a.interval.end.getTime() - b.interval.end.getTime();
            }),
        swimlanes: (rawTimeline.swimlanes || []).filter(swimlane => swimlane.hidden !== true),
        config: rawTimeline.config || {},
    };

    let font = parseStringOrDefault(timeline.config.font, null);
    const googleFont = parseStringOrDefault(timeline.config.googleFont, null);

    if (googleFont !== null) {
        triggerLoadGoogleFont(googleFont);
        font = googleFont;
    }

    const woff2Stylesheet = googleFont ? _loadedWoff2s[googleFont] : null;

    // if not a <generic-name>, encode as CSS <family-name> by quoting.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/font-family#family-name
    font = _cssFontGenericNames.includes(font.toLocaleLowerCase()) ? font : `"${font}"`;

    const width = parseIntOrDefault(timeline.config.width, DEFAULT_WIDTH);
    const dateLabels = parseBoolOrDefault(timeline.config.dateLabels, DEFAULT_USE_DATE_LABELS);
    const [hasGradient, gradientComponents] = parseGradient(timeline.config.palette?.gradient);
    const maskSize = parseIntOrDefault(timeline.config.palette?.stripes?.size, MASK_SIZE);
    const maskStrength = parseIntOrDefault(
        timeline.config.palette?.stripes?.strength,
        MASK_STRENGTH,
    );
    const useMask = !!timeline.config.palette?.stripes;
    const strokeThresholdL1 = parseIntOrDefault(
        timeline.config.palette?.outlines?.thresholdL1,
        STROKE_THRESHOLD,
    );
    const strokeDarkness = parseIntOrDefault(
        timeline.config.palette?.outlines?.strength,
        STROKE_DARKNESS,
    );
    const taskNameLabelTextSize = parseIntOrDefault(timeline.config.fontSizes?.taskNames, 12);
    const taskDateLabelTextSize = parseIntOrDefault(timeline.config.fontSizes?.taskDates, 10);
    const titleTextSize = timeline.title
        ? parseIntOrDefault(timeline.config.fontSizes?.title, 20)
        : 0;

    const textPadding = 6;
    const labelPadding = 12;
    const dateRangePadding = 6;
    const taskHeight = parseIntOrDefault(timeline.config.padding?.taskHeight, 15);
    const taskPadding = parseIntOrDefault(timeline.config.padding?.tasks, 5);
    const swimlanePadding = parseIntOrDefault(timeline.config.padding?.swimlanes, 5);
    const chartPaddingX = parseIntOrDefault(
        timeline.config.padding?.chartX,
        DEFAULT_PADDING_CHARTX,
    );
    const chartPaddingY = parseIntOrDefault(
        timeline.config.padding?.chartY,
        DEFAULT_PADDING_CHARTY,
    );
    const swimlaneLabelPadding = 5;
    const backgroundColor = parseStringOrDefault(timeline.config.palette?.backgroundColor, "white");
    const defaultGridColor = getContrastingColor(backgroundColor, 0.1, 0.1);
    const xAxisGridColor = parseStringOrDefault(
        timeline.config.palette?.gridColor,
        defaultGridColor,
    );
    const taskLabelTextColor = getContrastingColor(backgroundColor, 0.9, 0.9);
    const titleTextColor = taskLabelTextColor;
    const taskDateLabelTextColor = getContrastingColor(backgroundColor, 0.55, 0.6);
    const xAxisGridTicks = parseIntOrDefault(timeline.config.gridTicks, DEFAULT_GRID_TICKS);
    const titlePaddingTop = timeline.title ? 8 : 0;
    const titlePaddingBottom = timeline.title ? 18 : 0;
    const maxSwimlaneLabelWidth = timeline.swimlanes.reduce(
        (max, curr) => Math.max(measureText(curr.name, taskNameLabelTextSize, font), max),
        0,
    );
    const chartMarginTop =
        20 + titleTextSize + titlePaddingTop + titlePaddingBottom + chartPaddingY;
    const chartMarginLeft = Math.max(100, maxSwimlaneLabelWidth + labelPadding * 2);
    const scaleMarginTop = 5;
    const height =
        chartMarginTop +
        scaleMarginTop +
        timeline.tasks.length * (taskHeight + taskPadding) +
        timeline.swimlanes.length * swimlanePadding +
        2 * chartPaddingY;

    const dateScalePaddingPercent = 0.2;
    const minTaskDate = timeline.tasks
        .map(task => task.interval.start)
        .reduce((min, curr) => (!min || curr < min ? curr : min));
    const maxTaskDate = timeline.tasks
        .map(task => task.interval.end)
        .reduce((max, curr) => (!max || curr > max ? curr : max));
    const dateScalePaddingDays = Math.ceil(
        diffDays(minTaskDate, maxTaskDate) * dateScalePaddingPercent,
    );
    const minScaleDate = addDays(minTaskDate, -dateScalePaddingDays);
    const maxScaleDate = addDays(maxTaskDate, dateScalePaddingDays);

    // fixed point iteration for self-referential calculation
    let maxTaskLabelOverflowRight = 0;
    const numIters = 10;
    for (let iter = 0; iter < numIters; iter++) {
        maxTaskLabelOverflowRight = timeline.tasks
            .map(curr => {
                const mainSectionSize = width - chartMarginLeft - maxTaskLabelOverflowRight;
                const percent = (maxScaleDate - curr.interval.end) / (maxScaleDate - minScaleDate);
                const rightEdge = percent * mainSectionSize;

                return (
                    measureText(curr.name, taskNameLabelTextSize, font) +
                    textPadding -
                    rightEdge +
                    2
                ); // fex extra pixels just to be safe
            })
            .reduce((max, curr) => (curr > max ? curr : max), 0);
    }
    const chartMarginRight = maxTaskLabelOverflowRight;

    let cumulativeTaskIndex = 0;
    let tasksWithGradientIndex = 0;
    let numTasksWithGradient = timeline.swimlanes.filter(t => !t.color).length;
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
                tasksWithGradientIndex += 1;
            }

            return {
                ...swimlane,
                color: colorToUse,
            };
        })
        .map((swimlane, swimlaneIndex) => {
            const tasks = timeline.tasks
                .filter(task => task.swimlaneId === swimlane.id)
                .map((task, taskIndexInSwimlane) => ({
                    ...task,
                    swimlane,
                    swimlaneIndex,
                    taskIndexInSwimlane,
                    taskIndexOverall: taskIndexInSwimlane + cumulativeTaskIndex,
                }));

            const swimlaneWithCount = {
                ...swimlane,
                swimlaneIndex,
                taskIndexOverall: cumulativeTaskIndex,
                numTasks: tasks.length,
            };
            cumulativeTaskIndex += tasks.length;

            return { tasks, swimlane: swimlaneWithCount };
        });

    const svg = d3
        .create("svg")
        .attr("width", width + chartPaddingX * 2)
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
    defs.html(patterns.join("\n"));

    if (woff2Stylesheet) {
        svg.append("style").html(woff2Stylesheet);
    }

    if (timeline.title) {
        const title = svg
            .append("text")
            .text(timeline.title)
            .attr("x", width / 2 + chartPaddingX)
            .attr("y", titleTextSize + titlePaddingTop + chartPaddingY)
            .attr("font-size", titleTextSize)
            .attr("fill", titleTextColor)
            .attr("font-family", font)
            .attr("text-anchor", "middle");
    }

    const dateScale = d3
        .scaleUtc()
        .domain([minScaleDate, maxScaleDate])
        .range([chartMarginLeft + chartPaddingX, width - chartMarginRight + chartPaddingX]);

    const xAxisGrid = svg
        .selectAll("line.horizontalGrid")
        .data(dateScale.ticks(xAxisGridTicks))
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
        .call(xAxis)
        .attr("font-family", font)
        .attr("color", titleTextColor)
        .selectAll(".tick");

    cullOverlappingTickLabels([...xAxisTicks], font);

    for (const { tasks, swimlane } of perSwimlaneTasks) {
        const strokeHex = getStrokeHex(
            swimlane.color,
            backgroundColor,
            strokeDarkness,
            strokeThresholdL1,
        );
        const appendTaskRect = (enter, mask) => {
            let x = enter
                .append("rect")
                .attr("x", d => dateScale(d.interval.start))
                .attr(
                    "y",
                    d =>
                        chartMarginTop +
                        scaleMarginTop +
                        (taskHeight + taskPadding) * d.taskIndexOverall +
                        swimlanePadding * d.swimlaneIndex +
                        swimlanePadding / 2 +
                        (strokeHex ? 0.5 : 0),
                )
                .attr("width", d => dateScale(d.interval.end) - dateScale(d.interval.start))
                .attr("height", d => taskHeight - (strokeHex ? 0.5 : 0))
                .attr("fill", d => {
                    const fillColor = d.color ?? d.swimlane.color;
                    if (mask) {
                        return getContrastingColor(fillColor, maskStrength, maskStrength);
                    }
                    return fillColor;
                })
                .attr("stroke", d => strokeHex)
                .attr("stroke-width", d => (strokeHex ? 1 : 0));

            if (mask) {
                x.attr("mask", d => getMask(d.swimlane));
            }
        };

        const rectEnter = svg.selectAll("taskbars").data(tasks).enter();

        appendTaskRect(rectEnter, false);
        if (useMask) {
            appendTaskRect(rectEnter, true);
        }

        // <rect> and <text> do not align properly in chrome (2023-12-23), need very small adjustment
        const rectTextAlignmentOffsetHackPixels = 0.75;
        // TODO: split into multiple lines on overflow
        const taskTextLabels = svg
            .selectAll("tasktextlabels")
            .data(tasks)
            .enter()
            .append("text")
            .attr("x", d => dateScale(d.interval.end))
            .attr(
                "y",
                d =>
                    chartMarginTop +
                    scaleMarginTop +
                    (taskHeight + taskPadding) * d.taskIndexOverall +
                    swimlanePadding * d.swimlaneIndex +
                    swimlanePadding / 2,
            )
            .attr("dx", textPadding)
            .attr("dy", d => taskHeight / 2 + rectTextAlignmentOffsetHackPixels)
            .attr("font-size", taskNameLabelTextSize)
            .attr("dominant-baseline", "middle") // https://stackoverflow.com/a/15997503
            .attr("text-anchor", "start")
            .attr("font-family", font)
            .attr("fill", taskLabelTextColor)
            .text(d => d.name);

        if (dateLabels) {
            // TODO: fix overflow into left margin
            const taskDateLabels = svg
                .selectAll("taskdatelabels")
                .data(tasks)
                .enter()
                .append("text")
                .attr("x", d => dateScale(d.interval.start))
                .attr("y", d => {
                    return (
                        chartMarginTop +
                        scaleMarginTop +
                        (taskHeight + taskPadding) * d.taskIndexOverall +
                        swimlanePadding * d.swimlaneIndex +
                        swimlanePadding / 2
                    );
                })
                .attr("dx", d => -dateRangePadding)
                .attr("dy", d => taskHeight / 2 + rectTextAlignmentOffsetHackPixels)
                .attr("font-size", taskDateLabelTextSize)
                .attr("dominant-baseline", "middle") // https://stackoverflow.com/a/15997503
                .attr("font-family", font)
                .attr("text-anchor", "end")
                .attr("fill", taskDateLabelTextColor)
                .text(d => getDateRangeText(d.interval.start, d.interval.end));
        }
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
        .data(perSwimlaneTasks.map(p => p.swimlane))
        .enter();

    appendSwimlaneRect(swimlaneEnter, false);
    if (useMask) {
        appendSwimlaneRect(swimlaneEnter, true);
    }

    const swimlaneRectLabels = svg
        .selectAll("swimlanelabel")
        .data(perSwimlaneTasks.map(p => p.swimlane))
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
                swimlanePadding * d.swimlaneIndex,
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
        .attr("fill", d => getContrastingColor(d.color, 0.8, 1.0));

    if (timeline.config.showDeps) {
        const getTaskY = t =>
            chartMarginTop +
            scaleMarginTop +
            (taskHeight + taskPadding) * t.taskIndexOverall +
            swimlanePadding * t.swimlaneIndex +
            taskHeight / 2;

        const allTasks = perSwimlaneTasks.flatMap(p => p.tasks);
        const deps = [];
        for (const t1 of allTasks) {
            for (const depName of t1.deps || []) {
                const t2 = allTasks.find(t => t.name === depName);
                if (!t2) {
                    log("Can't find dependency?", t1, allTasks);
                    continue;
                }
                deps.push([t1, t2]);
            }
        }

        const depLines = svg
            .selectAll("taskDep")
            .data(deps)
            .enter()
            .append("line")
            .attr("stroke", "grey")
            .attr("x1", d => dateScale(d[0].interval.start))
            .attr("x2", d => dateScale(d[1].interval.end))
            .attr("y1", d => getTaskY(d[0]))
            .attr("y2", d => getTaskY(d[1]));
    }

    return svg.node();
}

/**
 * @param {string} initialJson
 * @param {boolean} isDark
 * @param {(json: string) => { }} onAfterRender
 */
async function initializeMonacoEditorAsynchronously(initialJson, isDark, onAfterRender) {
    _timeline = JSON.parse(initialJson);

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
                theme: getTheme(isDark),
                minimap: { enabled: false },
            });
            _debugGlobalMonacoEditor = editor;

            editor.getModel().onDidChangeContent(() => {
                const json = editor.getModel().createSnapshot().read();
                try {
                    _timeline = JSON.parse(json);
                    rerenderTimeline();
                    onAfterRender(json);
                } catch (e) {
                    console.warn("Exception while rendering timeline:", e);
                }
            });

            const overwriteText = textToWrite => {
                editor.getModel().setValue(textToWrite);
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

            resolve({ overwriteText, setTheme });
        });
    });
}

/** @param {string} duration */
function parseDuration(duration) {
    // Legacy support for invalid durations
    const matches = [...duration.matchAll("PT([0-9]+)D")];
    if (matches.length == 1) {
        return parseInt(matches[0][1]);
    }

    const fail = () => {
        throw new Error("Invalid duration: " + duration);
    };

    const iso8601NumberChars = "012345678890,.".split("");
    const numbersOnly = "012345678890".split("");
    const separatorsOnly = ",.".split("");

    const parse = chars => {
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
        ["P", ["Y", "M", "W", "D"]],
        ["T", ["H", "M", "S"]],
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
    for (const [partStart, subparts] of parts) {
        if (duration.charAt(i) !== partStart) {
            continue;
        }
        i++;
        let subpartIdx = 0;
        while (subpartIdx < subparts.length) {
            const num = [];
            while (i < duration.length) {
                const char = duration.charAt(i);
                if (!iso8601NumberChars.includes(char)) {
                    break;
                }
                i++;
                num.push(char);
            }
            const value = parse(num);

            while (subpartIdx < subparts.length) {
                const subpart = subparts[subpartIdx++];
                if (duration.charAt(i) === subpart) {
                    i++;

                    const key = `${partStart}${subpart}`;
                    if (components[key] !== undefined) {
                        fail();
                    }
                    components[key] = value;
                    break;
                }
            }
        }
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
            deps: (task.deps || []).map(d => taskNameToIdx[d]).sort(),
            fixedStartDateDays: task.fixedStartDateDays,
            fixedEndDateDays: task.fixedEndDateDays,
            durationDays: task.durationDays,
            swimlaneId: task.swimlaneId,
            width: task.width,
        };
    });

    const swimlaneKeys = swimlanes.map(s => {
        return {
            maxParallelism: s.maxParallelism || 1,
            id: s.id,
        };
    });

    return stringifyJson([taskKeys, swimlaneKeys]);
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

    const baseDate = parseDateOrDefault(timeline.config.startDate, new Date());
    const tasks = timeline.tasks.map((t, i) => ({
        ...t,
        durationDays: t.duration
            ? parseDuration(t.duration)
            : getDuration(t.interval.start, t.interval.end),
        fixedStartDateDays: t.interval ? diffDays(baseDate, new Date(t.interval.start)) : null,
        fixedEndDateDays: t.interval ? diffDays(baseDate, new Date(t.interval.end)) : null,
        globalIndex: i,
    }));

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

        // these are evaluated lexicographically
        // https://microsoft.github.io/z3guide/docs/optimization/combiningobjectives
        solver.minimize(lengthDays); // primary: minimize end date of timeline
        solver.minimize(sumDays); // secondary: pick earliest start for each task

        const makeVar = (...args) => args.join("_");
        const getTaskIdx = name => tasks.findIndex(t => t.name === name);
        const noOverlap = ([start1, end1], [start2, end2]) =>
            c.Or(c.GT(start1, end2), c.GT(start2, end1));
        const swimlaneIndex = task => timeline.swimlanes.findIndex(s => s.id === task.swimlaneId);

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
                solver.add(c.GT(ti_start[i], ti_end[j]));
            }

            const s = swimlaneIndex(task);
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

        solver.add(c.Eq(c.Sum(...ti_end), sumDays));

        for (let s = 0; s < til_present.length; s++) {
            const sTasks = tasks.filter(task => swimlaneIndex(task) == s);
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

        return [solver, ti_start, ti_end];
    }

    function getOrBuildSolver(cacheKey) {
        let currAttemptTimeout = _solutionCache[cacheKey]
            ? _solutionCache[cacheKey][2]
            : Z3_INITIAL_TIMEOUT_MS;

        const [solver, ti_start, ti_end] =
            cacheKey === _lastSolverCacheKey ? _lastSolverUsed : buildSolver();
        _lastSolverCacheKey = cacheKey;
        _lastSolverUsed = [solver, ti_start, ti_end];
        solver.set("timeout", currAttemptTimeout);

        return [..._lastSolverUsed, currAttemptTimeout];
    }

    async function solve() {
        const cacheKey = getCacheKey(tasks, timeline.swimlanes);
        let starts;
        let ends;
        if (!_solutionCache[cacheKey] || _solutionCache[cacheKey][2] !== null) {
            const logTime = timer();
            log("configuring solver...", logTime());
            const [solver, ti_start, ti_end, currAttemptTimeout] = getOrBuildSolver(cacheKey);
            log("configured solver.", logTime(), currAttemptTimeout);

            log("running solver...", logTime());
            onSolvingStart(currAttemptTimeout);
            const result = await solver.check();

            log(result, logTime());
            if (result == "unsat") {
                return null;
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
        _scheduledTimeline = await scheduleTasks(_timeline, timeout =>
            notifyOptimizingWithTimeout(timeout),
        );

        notifyRendering();
        const svg = renderTimeline(_scheduledTimeline);
        while (container.firstChild) {
            container.removeChild(container.lastChild);
        }
        container.append(svg);
        notifyRendered();
    } catch (e) {
        console.error("Building timeline failed", e);
        notifyFailed(e);
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
        const timelineHasUnsafedEdits = !readFromLocalStorage()[0] && _mutated;
        if (timelineHasUnsafedEdits) {
            e.preventDefault();
        }
    };
}

function writeOptimizedScheduleToMonaco() {
    if (_overwriteText !== null && _scheduledTimeline !== null) {
        const timelineToWrite = {
            ..._scheduledTimeline,
            tasks: _scheduledTimeline.tasks.map(t => ({
                ...t,
                interval: {
                    start: dateToIso(t.interval.start),
                    end: dateToIso(t.interval.end),
                },
            })),
        };
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
    ).then(({ overwriteText, setTheme }) => {
        _overwriteText = overwriteText;
        _setTheme = setTheme;
    });
    initializeTimelineWorker();
    initializeGoogleFontsWorker();
    rerenderTimeline();
}

main();
