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

const container = document.getElementById('container');
const monacoContainer = document.getElementById('monaco-container');
const downloadButton = document.getElementById('download-button');
const clipboardButton = document.getElementById('clipboard-button');
const fixedIntervalsButton = document.getElementById('fixedintervals-button');
const statusField = document.getElementById('status-field');
const localStorageCheckbox = document.getElementById('localstorage-checkbox');
const localStorageCheckboxLabel = document.getElementById('localstorage-checkbox-label');
const localStorageCheckboxClickArea = document.getElementById('localstorage-checkbox-clickarea');

const TIMELINE_LOCAL_STORAGE_KEY = "_garygurlaskie_com_timelines";
const GFONT_LOCAL_STORAGE_KEY = "_garygurlaskie_com_gfont";
const DEFAULT_WIDTH = 800;
const DEFAULT_USE_DATE_LABELS = true;
const DEFAULT_FONT = 'sans-serif';
const DEFAULT_GRID_TICKS = 20;
const LINK_COLOR = '#3c5ca2';
const START_DATE_ISO = dateToIso(new Date());

let _z3 = null;
let _debugGlobalMonacoEditor;
let _timeline = makeSampleTimeline();
let _fontToLoad = null;
let _globalTimeoutMs = 20000;
let _lastKnownJson = null;
let _mutated = false;
var _randomTaskId = 1;
let _overwriteText = null;
let _renderNeeded = false;
let _scheduledTimeline = null;
let _hasGfontConsent = window.localStorage.getItem(GFONT_LOCAL_STORAGE_KEY);
const _triedFonts = new Set();
const _solutionCache = {};
const _loadedGoogleFonts = [];
// https://developer.mozilla.org/en-US/docs/Web/CSS/font-family#generic-name
const _cssFontGenericNames = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'];

setupPageLeavePrompt();

setupThreeStateButton(downloadButton, ["Download PNG", "...", "Download started!"], downloadPng);
setupThreeStateButton(clipboardButton, ["Copy to Clipboard", "...", "Copied!"], copyPngToClipboard);
setupThreeStateButton(fixedIntervalsButton, ["Write Optimized Schedule", "...", "Written!"], writeOptimizedScheduleToMonaco);

const [notifyOptimizing, notifyRendering, notifyRendered, notifyFailed, notifyTimeout]
    = setupStatusDisplay(statusField, ['Optimizing...', 'Rendering...', 'Rendered', 'Failed', `Timed out after ${_globalTimeoutMs / 1000} sec`]);

const isLocalStorageEnabled = setupFourStateToggle(
    localStorageCheckbox,
    localStorageCheckboxLabel,
    readFromLocalStorage()[0],
    ["Persisted", "Cleared local storage.", "Not persisted", "Persisting!"],
    [LINK_COLOR, "grey", "grey", LINK_COLOR],
    async (isOn) => isOn ? initLocalStorage() : clearLocalStorage());

function makeSampleTimeline() {
    return {
        title: 'Project A',
        config: {
            dateLabels: true,
            showDeps: false,
            width: 800,
            font: 'sans-serif',
            palette: { gradient: ['#3c5ca2', 'seagreen'] },
            startDate: START_DATE_ISO,
        },
        swimlanes: [
            { id: '1', name: 'A', maxParallelism: 3 },
            { id: '2', name: 'B', maxParallelism: 1 },
            { id: '3', name: 'C', maxParallelism: 2, hidden: false },
        ],
        tasks: [
            ...makeRandomTaskDAG(['1', '2', '3'], 10),
            makeRandomFixedTask('Fixed Task A', '1'),
            makeRandomFixedTask('Fixed Task B', '1'),
            makeRandomFixedTask('Fixed Task C', '3'),
        ]
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
    const tasks = [
        makeRandomFloatingTask(getName(), getSwimlane(), []),
        makeRandomFloatingTask(getName(), getSwimlane(), []),
    ];

    while (tasks.length < numTasks) {
        const numParents = randChoice([0, 1, 1, 1, 1, 2]);
        const parentIdxes = [...new Set(zeroArray(numParents).map(_ => randRange(0, tasks.length)))];
        tasks.push(makeRandomFloatingTask(getName(), getSwimlane(), parentIdxes.map(i => tasks[i].name)));
    }

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
        }
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
        duration: `PT${durationDays}D`,
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
 * @param {string[]} statuses
 * @returns {(() => {})[]} setStatus
 */
function setupStatusDisplay(textElt, statuses) {
    return statuses.map(status => (
        () => {
            textElt.innerText = status;
        }
    ));
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
    const setText = (idx) => {
        labelElt.innerText = labels[idx];
        labelElt.style.color = textColors[idx];
    };
    const updateState = async () => {
        const checked = checkboxElt.checked;
        await action(checked);
        setText(checked ? 3 : 1);
        setTimeout(() => setText(checked ? 0 : 2), 500);
    }

    checkboxElt.checked = initialValue;
    setText(initialValue ? 0 : 2);
    labelElt.onclick = async e => {
        e.preventDefault();
        checkboxElt.checked = !checkboxElt.checked;
        await updateState()
    }
    checkboxElt.onchange = async e => {
        e.preventDefault();
        await updateState();
    }
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
    const setText = (idx) => {
        button.innerText = labels[idx];
        if (idx == 0) {
            button.style.textDecoration = originalTextDecoration;
            button.style.color = originalColor;
            button.style.cursor = originalCursor;
        }
        else {
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
    }
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
            }
            catch (err) {
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

// https://stackoverflow.com/a/35373030
const measureText = ((() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    return function measureText(text, fontSize, font) {
        context.font = fontSize + 'px ' + font;
        return context.measureText(text).width;
    }
})());

// https://stackoverflow.com/a/47355187
const standardizeColor = ((() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    return function standardizeColor(str) {
        context.fillStyle = str;
        return context.fillStyle;
    }
})());

// https://stackoverflow.com/a/5438011
/** @returns {Promise<HTMLCanvasElement>} */
async function renderAsCanvas() {
    return new Promise((resolve) => {
        const svg = renderTimeline(_scheduledTimeline);
        const width = svg.width.baseVal.value * 2;
        const height = svg.height.baseVal.value * 2;
        const paddingX = 40;
        const paddingY = 40;
        const svgAsXML = new XMLSerializer().serializeToString(svg); // TODO: is this redundant?

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const loader = new Image();
        loader.width = width;
        loader.height = height;
        canvas.width = width + 2 * paddingX;
        canvas.height = height + 2 * paddingY;

        loader.onload = () => {
            context.fillStyle = "white";
            context.fillRect(0, 0, width + 2 * paddingX, height + 2 * paddingY);
            context.drawImage(loader, paddingX, paddingY, width, height);
            resolve(canvas);
        };
        loader.src = 'data:image/svg+xml,' + encodeURIComponent(svgAsXML);
    });
};

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
    const blob = await renderAsCanvas()
        .then(canvas => new Promise(resolve => canvas.toBlob(resolve)));

    try {
        log("writing to clipboard...", blob);
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (error) {
        console.error(error);
    }
}

// https://stackoverflow.com/a/65917124
/** @param {string} url */
function addStylesheetWithUrl(url) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.getElementsByTagName('head')[0].appendChild(link);
}

/** @param {string} fontName */
function getGFontConsent(fontName) {
    if (_hasGfontConsent === null) {
        const result = confirm(`To load Google Fonts, this page will trigger requests to the Google Fonts API containing the font names you type (e.g., "${fontName}"). Continue?`)
        _hasGfontConsent = `${result}`;
        window.localStorage.setItem(GFONT_LOCAL_STORAGE_KEY, _hasGfontConsent);
    }

    return _hasGfontConsent === 'true';
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
        log(`not loading font '${fontName}' - previously declined`)
        return false;
    }
    else if (gfontConsent === true) {
        log(`loading font '${fontName}' - previously consented`)
    }

    const url = `https://fonts.googleapis.com/css2?family=${fontName}`;
    try {
        const response = await fetch(url);
        if (response.status < 200 || response.status >= 400) {
            console.warn(`Font '${fontName}' does not exist`, response.status);
        }
    } catch (e) {
        console.warn('Caught exception loading font', fontName, e);
        return;
    }

    if (!_loadedGoogleFonts.includes(fontName)) {
        _loadedGoogleFonts.push(fontName);
        addStylesheetWithUrl(url);
    }
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
    }
    else {
        writeToLocalStorage(JSON.stringify(_timeline, null, 2));
    }
}

/** @param {Date} date */
function dateToIso(date) {
    return date.toISOString().split('T')[0];
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
    const startText = start.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    })
    const endText = end.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    })
    if (startText === endText) {
        return start;
    }
    return `${startText} - ${endText}`;
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
 * @param {string} hex
 * @returns {RGBColor}
 */
function colorToRgb(hex) {
    const color = standardizeColor(hex);
    if (!color || color.length !== 7) {
        console.warn("Failed to standardize color", hex, color);
        return undefined;
    }

    return [
        color.substring(1, 3),
        color.substring(3, 5),
        color.substring(5, 7),
    ].map(c => parseInt(c, 16));
}

/** @param {RGBColor} rgb */
function rgbToColor(rgb) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * @param {[string, string]} gradient
 * @returns {[boolean, RGBColor?, RGBColor?]}
 */
function parseGradient(gradient) {
    if (!gradient) {
        return [false, undefined, undefined];
    }
    if (gradient.length != 2) {
        console.warn('Could not parse gradient', gradient);
        return [false, undefined, undefined];
    }

    const start = colorToRgb(gradient[0]);
    const end = colorToRgb(gradient[1]);
    return [start !== undefined && end !== undefined, start, end];
}

/**
 * @param {RGBColor} start
 * @param {RGBColor} end
 * @param {number} t truncated to [0, 1]
 * @returns {RGBColor}
 */
function interpolateColor(start, end, t) {
    t = Math.max(0, Math.min(1, t));
    return [
        Math.max(0, Math.min(Math.round((1 - t) * start[0] + t * end[0]), 255)),
        Math.max(0, Math.min(Math.round((1 - t) * start[1] + t * end[1]), 255)),
        Math.max(0, Math.min(Math.round((1 - t) * start[2] + t * end[2]), 255)),
    ];
}

/**
 * @param {number} lo
 * @param {number} hiExcl
 */
function randRange(lo, hiExcl) {
    return Math.floor(Math.random() * (hiExcl - lo) + lo);
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
            throw new Error(`Task '${task.id}' ('${task.name}') has invalid swimlane id ${task.swimlaneId}.`)
        }
    }
}

// Approach discussed https://groups.google.com/g/d3-js/c/oVbg5HkAoH4?pli=1
// Code suggested there doesn't work anymore for d3v7
// This is an alternative implementation.
function cullOverlappingTickLabels(xAxisTicks, font) {
    try {
        const minAxisPadding = 8;
        const labelTextSize = 9;
        const getXAndRadius = (c) => {
            const cText = c.textContent;
            const cTransform = c.attributes.transform.value; // of the form "translate(x, y)"
            const [_, x, y] = [...cTransform.matchAll('translate\\(\\s*([^,]+)\\s*,\\s*([^,]+)\\s*\\)')][0].map(parseFloat);
            const width = measureText(cText, labelTextSize, font);
            return [x, width / 2];
        }

        const toRemove = [];
        for (let i = 0; i < xAxisTicks.length - 1; i++) {
            const curr = xAxisTicks[i];
            let adjacent = xAxisTicks[i + 1];

            const [cx, cr] = getXAndRadius(curr);
            let [nx, nr] = getXAndRadius(adjacent);

            // walk forward until we find a tick that doesn't overlap
            while (cx + cr + minAxisPadding > nx - nr) {
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
    }
    catch (err) {
        console.warn('Could not cull overlapping date labels', err);
    }
}

/**
 * @param {typeof _timeline} rawTimeline
 * @returns {SVGElement}
 */
function renderTimeline(rawTimeline) {
    assertTimelineValid(rawTimeline);

    const timeline = {
        ...rawTimeline,
        tasks: rawTimeline.tasks
            .filter(t => (rawTimeline.swimlanes || [])
                .filter(s => s.id === t.swimlaneId)
                .some(s => s.hidden !== true))
            .map(t => ({
                ...t,
                interval: {
                    start: new Date(t.interval.start),
                    end: new Date(t.interval.end),
                }
            }))
            .sort((a, b) => {
                const diff = a.interval.start.getTime() - b.interval.start.getTime();
                if (diff != 0) {
                    return diff;
                }
                return a.interval.end.getTime() - b.interval.end.getTime();
            }),
        swimlanes: (rawTimeline.swimlanes || [])
            .filter(swimlane => swimlane.hidden !== true),
        config: rawTimeline.config || {},
    };

    let font = parseStringOrDefault(timeline.config.font, null);
    const googleFont = parseStringOrDefault(timeline.config.googleFont, null);

    if (googleFont !== null) {
        triggerLoadGoogleFont(googleFont);
        font = googleFont;
    }

    // if not a <generic-name>, encode as CSS <family-name> by quoting.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/font-family#family-name
    font = _cssFontGenericNames.includes(font.toLocaleLowerCase()) ? font : `"${font}"`;

    const width = parseIntOrDefault(timeline.config.width, DEFAULT_WIDTH);
    const dateLabels = parseBoolOrDefault(timeline.config.dateLabels, DEFAULT_USE_DATE_LABELS);
    const [hasGradient, gradientStart, gradientEnd] = parseGradient(timeline.config.palette?.gradient);
    const taskNameLabelTextSize = 12;
    const taskDateLabelTextSize = 10;
    const textPadding = 6;
    const labelPadding = 12;
    const dateRangePadding = 6;
    const taskHeight = 15;
    const taskPadding = 5;
    const taskLabelTextColor = "#000";
    const taskDateLabelTextColor = "#555";
    const xAxisGridColor = "#d0dce0";
    const xAxisGridTicks = parseIntOrDefault(timeline.config.gridTicks, DEFAULT_GRID_TICKS);
    const swimlanePadding = 5;
    const titleTextSize = timeline.title ? 16 : 0;
    const titlePaddingTop = timeline.title ? 8 : 0;
    const titlePaddingBottom = timeline.title ? 18 : 0;
    const maxSwimlaneLabelWidth = timeline.swimlanes.reduce((max, curr) => Math.max(measureText(curr.name, taskNameLabelTextSize, font), max), 0);
    const chartMarginTop = 20 + titleTextSize + titlePaddingTop + titlePaddingBottom;
    const chartMarginLeft = Math.max(100, maxSwimlaneLabelWidth + labelPadding * 2);
    const scaleMarginTop = 5;
    const height = chartMarginTop + scaleMarginTop
        + timeline.tasks.length * (taskHeight + taskPadding)
        + timeline.swimlanes.length * swimlanePadding;

    const dateScalePaddingPercent = 0.2;
    const minTaskDate = timeline.tasks
        .map(task => task.interval.start)
        .reduce((min, curr) => (!min || curr < min) ? curr : min);
    const maxTaskDate = timeline.tasks
        .map(task => task.interval.end)
        .reduce((max, curr) => (!max || curr > max) ? curr : max);
    const dateScalePaddingDays = Math.ceil(diffDays(minTaskDate, maxTaskDate) * dateScalePaddingPercent);
    const minScaleDate = addDays(minTaskDate, -dateScalePaddingDays);
    const maxScaleDate = addDays(maxTaskDate, dateScalePaddingDays);

    // fixed point iteration for self-referential calculation
    let maxTaskLabelOverflowRight = 0;
    const numIters = 10;
    for (let iter = 0; iter < numIters; iter++) {
        maxTaskLabelOverflowRight = timeline.tasks.map((curr) => {
            const mainSectionSize = width - chartMarginLeft - maxTaskLabelOverflowRight;
            const percent = (maxScaleDate - curr.interval.end) / (maxScaleDate - minScaleDate);
            const rightEdge = percent * mainSectionSize;

            return measureText(curr.name, taskNameLabelTextSize, font) + textPadding
                - rightEdge
                + 2 // fex extra pixels just to be safe
        }).reduce((max, curr) => curr > max ? curr : max, 0);
    }
    const chartMarginRight = maxTaskLabelOverflowRight;

    let cumulativeTaskIndex = 0
    const perSwimlaneTasks = timeline.swimlanes
        .map((swimlane, swimlaneIndex, allSwimlanes) => {
            let colorToUse = swimlane.color;
            if (!colorToUse && hasGradient) {
                const t = swimlaneIndex * 1.0 / (allSwimlanes.length - 0.99);
                const rgb = interpolateColor(gradientStart, gradientEnd, t);
                colorToUse = rgbToColor(rgb);
            }

            return {
                ...swimlane,
                color: colorToUse
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
            }
            cumulativeTaskIndex += tasks.length;

            return { tasks, swimlane: swimlaneWithCount };
        });

    const svg = d3.create("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("font-family", font)
        .style("background", "white");

    if (timeline.title) {
        const title = svg.append("text")
            .text(timeline.title)
            .attr("x", width / 2)
            .attr("y", titleTextSize + titlePaddingTop)
            .attr("font-size", titleTextSize)
            .attr("font-family", font)
            .attr("text-anchor", "middle")
    }

    const dateScale = d3.scaleUtc()
        .domain([minScaleDate, maxScaleDate])
        .range([chartMarginLeft, width - chartMarginRight])

    const xAxisGrid = svg.selectAll('line.horizontalGrid')
        .data(dateScale.ticks(xAxisGridTicks))
        .enter()
        .append("line")
        .attr("x1", d => dateScale(d))
        .attr("x2", d => dateScale(d))
        .attr("y1", chartMarginTop)
        .attr("y2", height)
        .attr("stroke", xAxisGridColor)

    const xAxis = d3.axisTop(dateScale);
    const xAxisTicks = svg.append("g")
        .attr("transform", `translate(0, ${chartMarginTop})`)
        .call(xAxis)
        .attr("font-family", font)
        .selectAll('.tick');

    cullOverlappingTickLabels([...xAxisTicks], font);

    for (const { tasks, swimlane } of perSwimlaneTasks) {
        const taskRects = svg.selectAll("taskbars")
            .data(tasks)
            .enter()
            .append("rect")
            .attr("x", d => dateScale(d.interval.start))
            .attr("y", d => {
                return chartMarginTop + scaleMarginTop
                    + (taskHeight + taskPadding) * d.taskIndexOverall
                    + swimlanePadding * d.swimlaneIndex;
            })
            .attr("width", d => dateScale(d.interval.end) - dateScale(d.interval.start))
            .attr("height", d => taskHeight)
            .attr("fill", d => d.swimlane.color)

        // <rect> and <text> do not align properly in chrome (2023-12-23), need very small adjustment
        const rectTextAlignmentOffsetHackPixels = 0.75;
        // TODO: split into multiple lines on overflow
        const taskTextLabels = svg.selectAll("tasktextlabels")
            .data(tasks)
            .enter()
            .append("text")
            .attr("x", d => dateScale(d.interval.end))
            .attr("y", d => {
                return chartMarginTop + scaleMarginTop
                    + (taskHeight + taskPadding) * d.taskIndexOverall
                    + swimlanePadding * d.swimlaneIndex;
            })
            .attr("dx", textPadding)
            .attr("dy", d => taskHeight / 2 + rectTextAlignmentOffsetHackPixels)
            .attr("font-size", taskNameLabelTextSize)
            .attr("dominant-baseline", "middle") // https://stackoverflow.com/a/15997503
            .attr("text-anchor", "start")
            .attr("font-family", font)
            .attr("fill", taskLabelTextColor)
            .text(d => d.name)

        if (dateLabels) {
            // TODO: fix overflow into left margin
            const taskDateLabels = svg.selectAll("taskdatelabels")
                .data(tasks)
                .enter()
                .append("text")
                .attr("x", d => dateScale(d.interval.start))
                .attr("y", d => {
                    return chartMarginTop + scaleMarginTop
                        + (taskHeight + taskPadding) * d.taskIndexOverall
                        + swimlanePadding * d.swimlaneIndex;
                })
                .attr("dx", d => -dateRangePadding)
                .attr("dy", d => taskHeight / 2 + rectTextAlignmentOffsetHackPixels)
                .attr("font-size", taskDateLabelTextSize)
                .attr("dominant-baseline", "middle") // https://stackoverflow.com/a/15997503
                .attr("font-family", font)
                .attr("text-anchor", "end")
                .attr("fill", taskDateLabelTextColor)
                .text(d => getDateRangeText(d.interval.start, d.interval.end))
        }
    }

    const swimlaneRects = svg.selectAll("swimlanelabel")
        .data(perSwimlaneTasks.map(p => p.swimlane))
        .enter()
        .append("rect")
        .attr("x", 0)
        .attr("y", d => {
            return chartMarginTop + scaleMarginTop
                + (taskHeight + taskPadding) * d.taskIndexOverall
                + swimlanePadding * d.swimlaneIndex;
        })
        .attr("width", chartMarginLeft - 5)
        .attr("height", d => (taskHeight + taskPadding) * d.numTasks)
        .attr("fill", d => d.color)

    const swimlaneRectLabels = svg.selectAll("swimlanelabel")
        .data(perSwimlaneTasks.map(p => p.swimlane))
        .enter()
        .append("text")
        .text(d => d.name)
        .attr("x", chartMarginLeft / 2 - 2)
        .attr("y", d => {
            return chartMarginTop + scaleMarginTop
                + (taskHeight + taskPadding) * d.taskIndexOverall
                + swimlanePadding * d.swimlaneIndex;
        })
        .attr("dx", 0)
        .attr("dy", d => (taskHeight + taskPadding) * d.numTasks / 2 - taskPadding / 2 + taskNameLabelTextSize / 2)
        .attr("font-size", taskNameLabelTextSize)
        .attr("height", d => (taskHeight + taskPadding) * d.numTasks)
        .attr("text-anchor", "middle")
        .attr("font-family", font)
        .attr("fill", d => {
            // ensure enough contrast
            // rendering is low scale enough, OK to hit Canvas API
            const rgb = colorToRgb(d.color);
            if (rgb[0] + rgb[1] + rgb[2] < (255 * 1.6)) {
                return "white";
            }
            return rgbToColor(interpolateColor(rgb, colorToRgb("black"), 0.8));
        });

    if (timeline.config.showDeps) {
        const getTaskY = t => chartMarginTop + scaleMarginTop
            + (taskHeight + taskPadding) * t.taskIndexOverall
            + swimlanePadding * t.swimlaneIndex
            + (taskHeight / 2);

        const allTasks = perSwimlaneTasks.flatMap(p => p.tasks);
        const deps = [];
        for (const t1 of allTasks) {
            for (const depName of (t1.deps || [])) {
                const t2 = allTasks.find(t => t.name === depName);
                if (!t2) {
                    log("Can't find dependency?", t1, allTasks);
                    continue;
                }
                deps.push([t1, t2]);
            }
        }

        const depLines = svg.selectAll("taskDep")
            .data(deps)
            .enter()
            .append("line")
            .attr("stroke", "grey")
            .attr("x1", d => dateScale(d[0].interval.start))
            .attr("x2", d => dateScale(d[1].interval.end))
            .attr("y1", d => getTaskY(d[0]))
            .attr("y2", d => getTaskY(d[1]))
    }

    return svg.node();
}

/**
 * @param {string} initialJson
 * @param {(json: string) => { }} onAfterRender
 */
async function initializeMonacoEditorAsynchronously(initialJson, onAfterRender) {
    _timeline = JSON.parse(initialJson);

    return new Promise((resolve) => {
        // This `require` is provided by monaco-editor/min/vs/loader.js.
        require.config({ paths: { vs: 'monaco-editor/min/vs' } });
        require(['vs/editor/editor.main'], async () => {
            const modelUri = monaco.Uri.parse("https://garygurlaskie.com/gantt-chart-tool/internal.json");
            const model = monaco.editor.createModel(initialJson, "json", modelUri);

            log("Loading JSON schema...");
            try {
                const jsonSchema = await fetch("schema.json").then(r => r.json());
                monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                    validate: true,
                    schemas: [
                        {
                            uri: "https://garygurlaskie.com/gantt-chart-tool/schema.json",
                            fileMatch: [modelUri.toString()],
                            schema: jsonSchema,
                        }
                    ],
                });
                log("Loaded JSON schema.");
            } catch (e) {
                console.error('Failed to load JSON schema!', e);
            }
            const editor = monaco.editor.create(monacoContainer, {
                model: model,
                minimap: { enabled: false },
            });
            _debugGlobalMonacoEditor = editor;

            editor.getModel().onDidChangeContent(() => {
                const json = editor.getModel().createSnapshot().read();
                try {
                    _timeline = JSON.parse(json);
                    rerenderTimeline();
                    onAfterRender(json);
                }
                catch (e) {
                    console.warn("Exception while rendering timeline:", e);
                }
            });

            const overwriteText = (textToWrite) => {
                editor.getModel().setValue(textToWrite);
            };

            resolve(overwriteText);
        });
    });
}

/** @param {string} duration */
function parseDuration(duration) {
    const matches = [...duration.matchAll('PT([0-9]+)D')];
    if (matches.length != 1) {
        throw new Exception('Invalid duration: ' + duration);
    }
    return parseInt(matches[0][1]);
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

    return JSON.stringify([taskKeys, swimlaneKeys]);
}

/**
 * @param {typeof _timeline} timeline
 * @returns {typeof _timeline}
 */
async function scheduleTasks(timeline) {
    if (_z3 === null) {
        try {
            _z3 = await loadz3();
        }
        catch (err) {
            await sleep(1000);
            _z3 = await loadz3();
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

    const c = new _z3.Context('main');
    function getSolver() {
        // Modified version the constraint formulation of Job-Shop found in
        // https://smt.st/SAT_SMT_by_example.pdf (Chapter 22.8)
        // - binding/presence trick
        // - modified to work with DAG dependencies (instead of linear jobs)
        // - extended to handle "fixed" tasks (i.e., interruptions)

        const solver = new c.Optimize();
        const lengthDays = c.Int.const('lengthDays');
        const sumDays = c.Int.const('sumDays');
        solver.minimize(lengthDays);
        solver.minimize(sumDays);

        const makeVar = (...args) => args.join('_');
        const getTaskIdx = (name) => tasks.findIndex(t => t.name === name);
        const noOverlap = ([start1, end1], [start2, end2]) => c.Or(
            c.GT(start1, end2),
            c.GT(start2, end1),
        );
        const swimlaneIndex = (task) => timeline.swimlanes.findIndex(s => s.id === task.swimlaneId);

        const ti_start = tasks.map((task, i) => c.Int.const(makeVar(task, i, 'start')));
        const ti_end = tasks.map((task, i) => c.Int.const(makeVar(task, i, 'end')));
        const til_present = timeline.swimlanes.map(s => zeroArray(s.maxParallelism || 1).map(_ => ({})));
        const til_start = timeline.swimlanes.map(s => zeroArray(s.maxParallelism || 1).map(_ => ({})));
        const til_end = timeline.swimlanes.map(s => zeroArray(s.maxParallelism || 1).map(_ => ({})));
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            if (task.fixedStartDateDays) {
                solver.add(c.And(
                    c.Eq(ti_start[i], task.fixedStartDateDays),
                    c.Eq(ti_end[i], task.fixedEndDateDays)));
            }
            else {
                solver.add(c.Eq(ti_start[i].add(task.durationDays), ti_end[i]));
                solver.add(c.GE(ti_start[i], 0));

                solver.add(c.LE(ti_end[i], lengthDays));
            }

            for (const d of (task.deps || [])) {
                const j = getTaskIdx(d);
                solver.add(c.GT(ti_start[i], ti_end[j]));
            }

            const s = swimlaneIndex(task);
            const swimlane = timeline.swimlanes[s];
            const presence = [];
            for (let l = 0; l < (swimlane.maxParallelism || 1); l++) {
                til_present[s][l][i] = c.Int.const(makeVar(task, i, l, 'present'));
                solver.add(c.And(
                    c.GE(til_present[s][l][i], 0),
                    c.LE(til_present[s][l][i], 1)));
                til_start[s][l][i] = c.Int.const(makeVar(task, i, l, 'start'));
                til_end[s][l][i] = c.Int.const(makeVar(task, i, l, 'end'));

                solver.add(c.Implies(c.Eq(til_present[s][l][i], 1), c.Eq(til_start[s][l][i], ti_start[i])));
                solver.add(c.Implies(c.Eq(til_present[s][l][i], 1), c.Eq(til_end[s][l][i], ti_end[i])));

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
                                    [t_start[t2.globalIndex], t_end[t2.globalIndex]])
                            ));

                    }
                }
            }
        }

        return [solver, ti_start, ti_end];
    }

    async function solve() {
        const cacheKey = getCacheKey(tasks, timeline.swimlanes);
        let starts;
        let ends;
        if (!_solutionCache[cacheKey]) {
            const logTime = timer();
            log('configuring solver', logTime());
            const [solver, ti_start, ti_end] = getSolver();
            solver.set("timeout", _globalTimeoutMs);

            log('running solver...', logTime());
            const result = await solver.check();

            log(result, logTime());
            if (result == 'unsat') {
                return null;
            }
            const model = solver.model();
            starts = ti_start.map(x => model.eval(x).value()).map(Number);
            ends = ti_end.map(x => model.eval(x).value()).map(Number);

            log(starts, ends);
            _solutionCache[cacheKey] = [starts, ends];
        }
        else {
            [starts, ends] = _solutionCache[cacheKey];
        }

        return {
            ...timeline,
            tasks: timeline.tasks.map((t, i) => ({
                ...t,
                interval: { start: addDays(baseDate, starts[i]), end: addDays(baseDate, ends[i]) }
            }))
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
    if (sab && (reload === null || (new Date().getTime() - parseInt(reload) > 15000))) {
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
        _scheduledTimeline = await scheduleTasks(_timeline);

        notifyRendering();
        const svg = renderTimeline(_scheduledTimeline);
        while (container.firstChild) {
            container.removeChild(container.lastChild);
        }
        container.append(svg);
        notifyRendered();
    } catch (e) {
        console.error('Building timeline failed', e);
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
        }
        const timelineJson = JSON.stringify(timelineToWrite, null, 2);
        _overwriteText(timelineJson);
        writeToLocalStorage(timelineJson);
    }
}

function log(...args) {
    console.log(...args);
}

async function main() {
    log('running script');

    const [exists, storedJson] = readFromLocalStorage();
    const jsonToUse = exists ? storedJson : JSON.stringify(_timeline, null, 2)
    initializeMonacoEditorAsynchronously(jsonToUse, renderedJson => writeToLocalStorage(renderedJson))
        .then((overwriteText) => {
            _overwriteText = overwriteText;
        });
    initializeTimelineWorker();
    initializeGoogleFontsWorker();
    rerenderTimeline();
}

main();