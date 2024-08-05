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

function randRange(lo, hi) {
    return Math.floor(Math.random() * (hi - lo) + lo);
}

const dayToMs = 1000 * 60 * 60 * 24;

/**
 * @typedef {typeof timeline} Timeline
 * @typedef {typeof timeline.tasks[0]} RawTask
 * @typedef {typeof timeline.swimlanes[0]} Swimlane
 * @typedef {typeof timeline.config} Config
 */
var timeline = {
    title: 'Project A',
    config: {
        dateLabels: true,
        width: 800,
        font: 'sans-serif',
        baseDate: "2024-08-01"
    },
    swimlanes: [
        {
            id: '1',
            name: 'Coding Tasks',
            color: '#0071c5',
            compress: false,
            parallelism: 2,
            workers: ["Engineer A", "Engineer B"],
        },
        {
            id: '2',
            name: 'Other Tasks',
            color: '#71c500',
            compress: false,
            parallelism: 2,
            workers: ["Engineer A", "Engineer B"],
        }
    ],
    tasks: [
        randomTask("Task 1A", "1"),
        randomTask("Task 1B", "1"),
        randomTask("Task 1C", "1"),
        randomTask("Task 1D", "1"),
        randomTask("Task 1E", "1"),
        randomTask("Task 1F", "1"),
        randomTask("Task 1G", "1"),
        randomTask("Task 2A", "2"),
        randomTask("Task 2B", "2"),
        randomTask("Task 2C", "2"),
        randomTask("Task 2D", "2"),
        randomTask("Task 2E", "2"),
        randomTask("Task 2F", "2"),
        randomTask("Task 2G", "2"),
    ]
}

/**
 * @param {string} name 
 * @param {string} swimlaneId
 */
function randomTask(name, swimlaneId) {
    const p_duration = 0.8;
    const maxDays = 21;
    const minDays = 5;


    let timeProps;
    if (Math.random() < p_duration) {
        timeProps = {
            duration: `PT${randRange(minDays, maxDays)}D`,
        };
    }
    else {
        const startOffsetDays = randRange(0, maxDays * 3);
        const durationDays = randRange(minDays, maxDays)
        const baseDate = new Date(Date.now() + startOffsetDays * dayToMs);
        const endDate = new Date(Date.now() + (startOffsetDays + durationDays) * dayToMs);
        timeProps = {
            interval: {
                start: baseDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            }
        }
    }
    return Object.assign({
        name,
        swimlaneId,
    }, timeProps);
}

function addDays(date, days) {
    const ret = new Date(date);
    ret.setDate(ret.getDate() + days);
    return ret;
}

function diffDays(date1, date2) {
    return Math.ceil((date2 - date1) / (1000 * 60 * 60 * 24));
}

/**
 * 
 * @param {Timeline} timeline 
 */
function assertTimelineValid(timeline) {
    for (const task of timeline.tasks) {
        if ('interval' in task) {
            if (task.interval.start > task.interval.end) {
                throw new Error(`Task '${task.id}' ('${task.name}') has start > end.`);
            }
        }

        if (!timeline.swimlanes.some(swimlane => swimlane.id === task.swimlaneId)) {
            throw new Error(`Task '${task.id}' ('${task.name}') has invalid swimlane id ${task.swimlaneId}.`)
        }
    }
}

/**
 * @param {Date} d 
 */
function toUtcDateOnlyString(d) {
    d.toISOString().split('T')[0];
}

// https://stackoverflow.com/a/35373030
const measureText = ((() => {
    var canvas = document.createElement('canvas'),
        context = canvas.getContext('2d');

    return function measureText(text, fontSize, font) {
        context.font = fontSize + 'px ' + font;
        return context.measureText(text).width;
    }
})());

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
 * 
 * @param {number} lo 
 * @param {number} hi 
 * @returns {number[]}
 */
function range(lo, hi) {
    const ans = [];
    for (let i = lo; i < hi; i++) {
        ans.push(i);
    }
    return ans;
}

/**
 * @template T
 * @param {T[]} seq 
 * @param {int} n 
 * @returns {T[][]}
 */
function sequenceProduct(seq, n) {
    const ans = [];
    const stack = [[]];
    seq = seq.slice();
    seq.reverse();
    while (stack.length > 0) {
        const top = stack.pop();
        if (top.length == n) {
            ans.push(top);
        }
        else {
            for (const elt of seq) {
                const next = top.slice();
                next.push(elt);
                stack.push(next);
            }
        }
    }
    return ans;
}

/**
 * @param {RawTask} rawTask
 * @typedef {ReturnType<parseTask>} Task
 */
function parseTask(rawTask) {
    if ('interval' in rawTask) {
        return {
            ...rawTask,
            interval: {
                ...rawTask.interval,
                startDate: new Date(rawTask.interval.start),
                endDate: new Date(rawTask.interval.end),
            }
        };
    }
    if ('duration' in rawTask) {
        return {
            ...rawTask,
            parsedDurationDays: parseInt(rawTask.duration.slice(2, rawTask.duration.length - 1))
        }
    }

    return rawTask;
}

/**
 * @typedef {ReturnType<assertTaskHasInterval>} TaskWithInterval
 * @param {Task} task 
 */
function assertTaskHasInterval(task) {
    if (task.interval === undefined) {
        throw new Error("Assertion failed: Task does not have 'interval': " + task);
    }

    return task;
}

/**
 * @param {[TaskWithInterval]} fixedTasks 
 * @param {Swimlane} swimlane 
 * @returns {number[][]} list of valid (nonconflicting) lane assignments
 */
function getValidAssignments(fixedTasks, swimlane) {
    const sortedFixedTasks = fixedTasks.slice().sort((t1, t2) => {
        return t1.interval.endDate.getTime() - t2.interval.endDate.getTime();
    });
    const ans = [];
    const assignemnts = range(0, swimlane.parallelism);
    for (const candidateAssignment of sequenceProduct(assignemnts, sortedFixedTasks.length)) {
        let isGood = true;
        const maxDateByLane = range(0, assignemnts.length).map(_ => new Date(0));
        for (let i = 0; i < candidateAssignment.length; i++) {
            const assignedLane = candidateAssignment[i];
            const task = sortedFixedTasks[i];
            if (task.interval.startDate < maxDateByLane[assignedLane]) {
                isGood = false;
                break;
            }
            maxDateByLane[assignedLane] = task.interval.endDate;
        }

        ans.push(candidateAssignment);
    }
    return ans;
}

/**
 * 
 * @param {number[]} assignment 
 * @param {[TaskWithInterval]} fixedTasks 
 * @param {Swimlane} swimlane 
 * @param {Date} baseDate
 */
function getSublanes(assignment, fixedTasks, swimlane, baseDate) {
    const endDate = new Date("9999-12-31");
    const intervals = range(0, swimlane.parallelism).map(_ => [[baseDate, endDate]]);
    for (let i = 0; i < assignment.length; i++) {
        const task = fixedTasks[i];
        const lane = assignment[i];

        intervals[lane] = intervals[lane]
            .map(interval => {
                const [start, end] = interval;
                if (task.interval.startDate >= end || task.interval.endDate <= start) {
                    return [[start, end]];
                }
                else if (task.interval.startDate <= start && task.interval.endDate >= end) {
                    return [];
                }
                else if (task.interval.startDate <= start) {
                    return [[start, task.interval.startDate]];
                }
                else if (task.interval.endDate >= end) {
                    return [[task.interval.endDate, end]];
                }
                else {
                    return [[start, task.interval.startDate], [task.interval.endDate, end]];
                }
            })
            .flat()
            .filter(i => i[0] < i[1]);
    }

    return intervals
        .map((intervals, idx) => intervals
            .map(i => ({
                interval: i,
                originalLaneIdx: idx,
                offset: i[0].getTime() - baseDate.getTime(),
            })))
        .flat();
}

/**
 * 
 * @param {ReturnType<getSublanes>} lanes 
 * @param {Task[]} tasks 
 * @returns {[number[], number]} assignment, score
 */
function solve(lanes, tasks) {
    const memo = {};
    function getKey(arr, i) {
        arr.push(i);
        const ans = arr.join('|');
        arr.pop();
        return ans;
    }
    function inner(lens, i) {
        if (i == tasks.length) {
            let maxLen = 0;
            for (let i = 0; i < lens.length; i++) {
                if (lens[i] > 0) {
                    const currLen = lens[i] + lanes[i].offset;
                    if (currLen > maxLen) {
                        maxLen = currLen;
                    }
                }
            }
            return [[], maxLen];
        }

        const key = getKey(lens, i);
        if (memo[key] !== undefined) {
            return memo[key];
        }

        const task = tasks[i];
        let best = null;
        let bestSeq = null;
        for (const j of range(0, lanes.length)) {
            const currLen = lens[j];
            const lane = lanes[j];
            const laneSize = lane.interval[1].getTime() - lane.interval[0].getTime();
            const fits = currLen + task.parsedDurationDays * dayToMs <= laneSize;
            if (fits) {
                lens[j] += task.parsedDurationDays * dayToMs;
                const [currSeq, currResult] = inner(lens, i + 1);
                lens[j] -= task.parsedDurationDays * dayToMs;

                if (currResult === null) {
                    continue;
                }

                if (best === null || currResult < best) {
                    best = currResult;
                    bestSeq = currSeq.slice();
                    bestSeq.push(j);
                }
            }
        }

        memo[key] = [bestSeq, best];
        return [bestSeq, best];
    }

    const initialLens = range(0, lanes.length).map(_ => 0);
    const ret = inner(initialLens, 0);
    const [seq, bestScore] = ret;
    console.log(seq, bestScore);
    seq.reverse();
    return [seq, bestScore];
}

/**
 * @param {{ tasks: RawTask[] }} rawTimeline 
 */
function getPreprocessedTasks(rawTimeline) {
    console.log('Starting preprocessing...');
    const baseDate = new Date(rawTimeline.config.baseDate);
    const processedTasks = []
    for (const swimlane of rawTimeline.swimlanes || []) {
        let bestSeq = null;
        let bestScore = Infinity;
        /** @type {ReturnType<getSublanes>} */
        let bestSublanes = null;
        /** @type {number[]} */
        let bestFixedTaskAssignment = null;

        const allTasks = rawTimeline.tasks
            .filter(t => t.swimlaneId == swimlane.id)
            .map(t => parseTask(t));

        // find optimal ordering
        const fixedTasks = allTasks.filter(t => t.interval);
        const freeTasks = allTasks.filter(t => t.duration);

        const assignments = getValidAssignments(fixedTasks, swimlane);
        for (const assignment of assignments) {
            const sublanes = getSublanes(assignment, fixedTasks, swimlane, baseDate);
            const [seq, score] = solve(sublanes, freeTasks);
            console.log("final", seq, score, sublanes);
            if (score < bestScore) {
                console.log("best");
                bestSeq = seq;
                bestScore = score;
                bestSublanes = sublanes;
                bestFixedTaskAssignment = assignment;
            }
        }

        // calculate start and end for optimal ordering
        let sublaneIdx = -1;
        const currTasks = [];
        for (const sublane of bestSublanes) {
            sublaneIdx += 1;
            let base = sublane.interval[0];
            for (let i = 0; i < freeTasks.length; i++) {
                if (bestSeq[i] != sublaneIdx) {
                    continue;
                }

                const task = { ...freeTasks[i] };
                task.interval = {
                    startDate: base,
                    endDate: new Date(base.getTime() + task.parsedDurationDays * dayToMs),
                };
                task.assignedSubSwimlaneIdx = sublane.originalLaneIdx;
                currTasks.push(task);
                base = new Date(base.getTime() + task.parsedDurationDays * dayToMs);
            }
        }

        for (let i = 0; i < fixedTasks.length; i++) {
            const task = fixedTasks[i];
            task.assignedSubSwimlaneIdx = bestFixedTaskAssignment[i];
            currTasks.push(task);
        }

        currTasks.sort((t1, t2) => {
            const cmp1 = t1.interval.startDate.getTime() - t2.interval.startDate.getTime();
            if (cmp1 != 0) {
                return cmp1;
            }

            const cmp2 = t1.interval.endDate.getTime() - t2.interval.endDate.getTime();
            if (cmp2 != 0) {
                return cmp2;
            }

            return 0;
        });
        processedTasks.push(...currTasks);
    }

    console.log('Finished preprocessing.');

    return processedTasks;
}

const DEFAULT_WIDTH = 800;
const DEFAULT_USE_DATE_LABELS = true;
const DEFAULT_FONT = 'sans-serif';

function renderTimeline(rawTimeline) {
    assertTimelineValid(rawTimeline);

    const timeline = {
        ...rawTimeline,
        tasks: getPreprocessedTasks(rawTimeline),
        swimlanes: rawTimeline.swimlanes || [],
        config: rawTimeline.config || {},
    };

    const font = parseStringOrDefault(timeline.config.font, DEFAULT_FONT);
    const width = parseIntOrDefault(timeline.config.width, DEFAULT_WIDTH);
    const dateLabels = parseBoolOrDefault(timeline.config.dateLabels, DEFAULT_USE_DATE_LABELS);
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
    const xAxisGridColor = "#ddd";
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
        .map(task => task.interval.startDate)
        .reduce((min, curr) => (!min || curr < min) ? curr : min);
    const maxTaskDate = timeline.tasks
        .map(task => task.interval.endDate)
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
            const percent = (maxScaleDate - curr.interval.endDate) / (maxScaleDate - minScaleDate);
            const rightEdge = percent * mainSectionSize;

            return measureText(curr.name, taskNameLabelTextSize, font) + textPadding
                - rightEdge
                + 2 // fex extra pixels just to be safe
        }).reduce((max, curr) => curr > max ? curr : max, 0);
    }
    const chartMarginRight = maxTaskLabelOverflowRight;

    let cumulativeTaskIndex = 0
    const perSwimlaneTasks = timeline.swimlanes.map((swimlane, swimlaneIndex) => {
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
        .data(dateScale.ticks(20))
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
            .attr("x", d => dateScale(d.interval.startDate))
            .attr("y", d => {
                return chartMarginTop + scaleMarginTop
                    + (taskHeight + taskPadding) * d.taskIndexOverall
                    + swimlanePadding * d.swimlaneIndex;
            })
            .attr("width", d => dateScale(d.interval.endDate) - dateScale(d.interval.startDate))
            .attr("height", d => taskHeight)
            .attr("fill", d => d.swimlane.color)

        // <rect> and <text> do not align properly in chrome (2023-12-23), need very small adjustment
        const rectTextAlignmentOffsetHackPixels = 0.75;
        // TODO: split into multiple lines on overflow
        const taskTextLabels = svg.selectAll("tasktextlabels")
            .data(tasks)
            .enter()
            .append("text")
            .attr("x", d => dateScale(d.interval.endDate))
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
                .attr("x", d => dateScale(d.interval.startDate))
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
                .text(d => getDateRangeText(d.interval.startDate, d.interval.endDate))
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
        .attr("fill", swimlaneLabelTextColor)

    return svg;
}

function rerenderTimeline() {
    const svg = renderTimeline(timeline);
    while (container.firstChild) {
        container.removeChild(container.lastChild);
    }
    container.append(svg.node());
}


var _debugGlobalMonacoEditor;
function initializeMonacoEditorAsynchronously() {
    require.config({ paths: { vs: 'monaco-editor/min/vs' } });
    require(['vs/editor/editor.main'], () => {
        const editor = monaco.editor.create(monacoContainer, {
            value: JSON.stringify(timeline, null, 2),
            language: 'json',
            minimap: { enabled: false },
        });
        _debugGlobalMonacoEditor = editor;

        editor.getModel().onDidChangeContent(() => {
            const json = editor.getModel().createSnapshot().read();
            timeline = JSON.parse(json);
            rerenderTimeline();
        });
    });
}

function main() {
    initializeMonacoEditorAsynchronously();
    rerenderTimeline();
}

main();
