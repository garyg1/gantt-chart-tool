/**
 * @license
 * Copyright (c) 2023 Gary Gurlaskie
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
const localStorageCheckbox = document.getElementById('localstorage-checkbox');
const localStorageCheckboxLabel = document.getElementById('localstorage-checkbox-label');
const localStorageCheckboxClickArea = document.getElementById('localstorage-checkbox-clickarea');

window.onbeforeunload = e => {
    if (!readFromLocalStorage()[0] && _mutated) {
        e.preventDefault();
    }
}

const TIMELINE_LOCAL_STORAGE_KEY = "_garygurlaskie_com_timelines";
const DEFAULT_WIDTH = 800;
const DEFAULT_USE_DATE_LABELS = true;
const DEFAULT_FONT = 'sans-serif';
const DEFAULT_GRID_TICKS = 20;
const LINK_COLOR = '#3c5ca2';

let _debugGlobalMonacoEditor;
let _mutated = false;
let _lastKnownJson = null;
let _timeline = {
    title: 'Project A',
    config: {
        dateLabels: true,
        width: 800,
        font: 'sans-serif',
        palette: { gradient: ['#3c5ca2', '#1b8961'] },
        startDate: '2024-08-15',
    },
    swimlanes: [
        { id: '1', name: 'Coding Tasks', maxParallelism: 2 }
    ],
    tasks: [
        {
            name: 'Create Widgets',
            duration: 'PT5D',
            swimlaneId: '1'
        },
        {
            name: 'Implement Widget Factory',
            duration: 'PT10D',
            deps: ['Create Widgets'],
            swimlaneId: '1'
        },
        {
            name: 'Implement Widget Factory Manager',
            duration: 'PT15D',
            deps: ['Implement Widget Factory'],
            swimlaneId: '1'
        },
        {
            name: 'Implement Widget Factory #2',
            duration: 'PT10D',
            deps: ['Create Widgets'],
            swimlaneId: '1'
        },
        {
            name: 'Implement Widget Factory #3',
            duration: 'PT5D',
            deps: ['Create Widgets'],
            swimlaneId: '1'
        },
        {
            name: 'Task 4',
            interval: { start: '2024-08-25', end: '2024-09-16' },
            swimlaneId: '1'
        }
    ]
};

setupThreeStateButton(downloadButton, ["Download PNG", "...", "Download started!"], downloadPng);
setupThreeStateButton(clipboardButton, ["Copy to Clipboard", "...", "Copied!"], copyPngToClipboard);
const isLocalStorageEnabled = setupFourStateToggle(
    localStorageCheckbox,
    localStorageCheckboxLabel,
    readFromLocalStorage()[0],
    ["Persisted", "Cleared local storage.", "Not persisted", "Persisting!"],
    [LINK_COLOR, "grey", "grey", LINK_COLOR],
    async (isOn) => isOn ? initLocalStorage() : clearLocalStorage());

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

async function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
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
        const svg = renderTimeline(_timeline).node();
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
        console.log("writing to clipboard...", blob);
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (error) {
        console.error(error);
    }
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

function addDays(date, days) {
    const ret = new Date(date);
    ret.setDate(ret.getDate() + days);
    return ret;
}

function diffDays(date1, date2) {
    return Math.ceil((date2 - date1) / (1000 * 60 * 60 * 24));
}

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

function parseIntOrDefault(maybeInt, defaultIfNotInt) {
    if (typeof maybeInt === "number") {
        return maybeInt;
    }
    return defaultIfNotInt;
}

function parseStringOrDefault(maybeString, defaultIfNotString) {
    if (typeof maybeString === "string") {
        return maybeString;
    }
    return defaultIfNotString;
}

function parseBoolOrDefault(maybeBool, defaultIfNotBool) {
    if (maybeBool === true || maybeBool === false) {
        return maybeBool;
    }
    return defaultIfNotBool;
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
 * @param {typeof _timeline} rawTimeline 
 */
function renderTimeline(rawTimeline) {
    assertTimelineValid(rawTimeline);

    const timeline = {
        ...rawTimeline,
        tasks: rawTimeline.tasks
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
        swimlanes: rawTimeline.swimlanes || [],
        config: rawTimeline.config || {},
    };

    const font = parseStringOrDefault(timeline.config.font, DEFAULT_FONT);
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
    const swimlaneLabelTextColor = "#fff";
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

    const xAxis = svg.append("g")
        .attr("transform", `translate(0, ${chartMarginTop})`)
        .call(d3.axisTop(dateScale))

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

    return svg;
}

async function rerenderTimeline() {
    const timeline = await scheduleTasks(_timeline);
    const svg = renderTimeline(timeline);
    while (container.firstChild) {
        container.removeChild(container.lastChild);
    }
    container.append(svg.node());
}


function initializeMonacoEditorAsynchronously(initialJson, onRender) {
    _timeline = JSON.parse(initialJson);

    require.config({ paths: { vs: 'monaco-editor/min/vs' } });
    require(['vs/editor/editor.main'], () => {
        const editor = monaco.editor.create(monacoContainer, {
            value: initialJson,
            language: 'json',
            minimap: { enabled: false },
        });
        _debugGlobalMonacoEditor = editor;

        editor.getModel().onDidChangeContent(() => {
            const json = editor.getModel().createSnapshot().read();
            try {
                _timeline = JSON.parse(json);
                rerenderTimeline();
                onRender(json);
            }
            catch (e) {
                console.warn("Exception while rendering timeline:", e);
            }
        });
    });
}

function main() {
    const [exists, storedJson] = readFromLocalStorage();
    const jsonToUse = exists ? storedJson : JSON.stringify(_timeline, null, 2)
    initializeMonacoEditorAsynchronously(jsonToUse, renderedJson => writeToLocalStorage(renderedJson));
    rerenderTimeline();
}


main();

/**
 * @param {string} duration 
 */
function parseDuration(duration) {
    const matches = [...duration.matchAll('PT([0-9]+)D')];
    if (matches.length != 1) {
        throw new Exception('Invalid duration: ' + duration);
    }
    return parseInt(matches[0][1]);
}

/**
 * 
 * @param {string} start 
 * @param {string} end 
 */
function getDuration(start, end) {
    return diffDays(new Date(start), new Date(end));
}

function zeroArray(length) {
    const arr = [];
    for (let i = 0; i < length; i++) {
        arr.push(0);
    }
    return arr;
}

/**
 * @param {typeof _timeline} timeline 
 */
async function scheduleTasks(timeline) {
    const baseDate = new Date(timeline.config.startDate);
    const tasks = timeline.tasks.map((t, i) => ({
        ...t,
        durationDays: t.duration
            ? parseDuration(t.duration)
            : getDuration(t.interval.start, t.interval.end),
        fixedStartDateDays: t.interval ? diffDays(baseDate, new Date(t.interval.start)) : null,
        fixedEndDateDays: t.interval ? diffDays(baseDate, new Date(t.interval.end)) : null,
        globalIndex: i,
    }));
    const z3 = await loadz3();
    const c = new z3.Context('main');
    const solver = new c.Solver();

    const lengthDays = c.Int.const('lengthDays');
    solver.add(c.LE(lengthDays, 45))

    const makeVar = (...args) => args.join('_');
    const getTaskIdx = (name) => tasks.findIndex(t => t.name === name);
    const noOverlap = ([start1, end1], [start2, end2]) => c.Or(
        c.GT(start1, end2),
        c.GT(start2, end1),
    );
    const swimlaneIndex = (task) => timeline.swimlanes.findIndex(s => s.id === task.swimlaneId);

    const ti_start = tasks.map((task, i) => c.Int.const(makeVar(task, i, 'start')));
    const ti_end = tasks.map((task, i) => c.Int.const(makeVar(task, i, 'end')));
    const til_present = timeline.swimlanes.map(s => zeroArray(s.maxParallelism).map(_ => ({})));
    const til_present_int = timeline.swimlanes.map(s => zeroArray(s.maxParallelism).map(_ => ({})));
    const til_start = timeline.swimlanes.map(s => zeroArray(s.maxParallelism).map(_ => ({})));
    const til_end = timeline.swimlanes.map(s => zeroArray(s.maxParallelism).map(_ => ({})));
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

            for (const d of (task.deps || [])) {
                const j = getTaskIdx(d);
                solver.add(c.GT(ti_start[i], ti_end[j]));
            }

            solver.add(c.LE(ti_end[i], lengthDays));
        }

        const s = swimlaneIndex(task);
        const swimlane = timeline.swimlanes[s];
        const presence = [];
        for (let l = 0; l < swimlane.maxParallelism; l++) {
            til_present[s][l][i] = c.Bool.const(makeVar(task, i, l, 'present'));
            til_start[s][l][i] = c.Int.const(makeVar(task, i, l, 'start'));
            til_end[s][l][i] = c.Int.const(makeVar(task, i, l, 'end'));
            console.log(til_present[s][l][i]);

            solver.add(c.Implies(c.Eq(til_present[s][l][i], true), c.Eq(til_start[s][l][i], ti_start[i])));
            solver.add(c.Implies(c.Eq(til_present[s][l][i], true), c.Eq(til_end[s][l][i], ti_end[i])));

            presence.push(c.If(til_present[s][l][i], 1, 0));
            til_present_int[s][l][i] = c.Int.const(makeVar(task, i, l, 'pint'));
            solver.add(c.Eq(til_present_int[s][l][i], c.If(til_present[s][l][i], 1, 0)));
        }
        solver.add(c.Eq(c.Sum(...presence), 1));
    }

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
                                c.Eq(true, t_present[t1.globalIndex]),
                                c.Eq(true, t_present[t2.globalIndex]),
                            ),
                            noOverlap(
                                [t_start[t1.globalIndex], t_end[t1.globalIndex]],
                                [t_start[t2.globalIndex], t_end[t2.globalIndex]])
                        ));

                }
            }
        }
    }

    console.log(await solver.check());
    const model = solver.model();
    const starts = ti_start.map(x => model.eval(x).value()).map(Number);
    const ends = ti_end.map(x => model.eval(x).value()).map(Number);

    return {
        ...timeline,
        tasks: timeline.tasks.map((t, i) => ({
            ...t,
            interval: { start: addDays(baseDate, starts[i]), end: addDays(baseDate, ends[i]) }
        }))
    };
}

scheduleTasks(_timeline);
