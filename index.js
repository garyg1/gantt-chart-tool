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

var timeline = {
    title: 'Project A',
    config: {
        dateLabels: true,
        width: 800,
        font: 'sans-serif',
    },
    swimlanes: [
        {
            id: '1',
            name: 'Coding Tasks',
            color: '#0071c5',
            compress: false,
            parellelism: 1,
        },
        {
            id: '2',
            name: 'Non-coding tasks',
            color: '#00c571'
        },
        {
            id: '3',
            name: 'Dependencies',
            color: '#7100c5'
        }
    ],
    tasks: [
        {
            name: 'Create Widgets',
            interval: {
                start: '2023-10-01',
                end: '2023-10-05',
            },
            swimlaneId: '1',
        },
        {
            name: 'Implement Widget Factory',
            interval: {
                start: '2023-10-10',
                end: '2023-10-15',
            },
            swimlaneId: '1',
        },
        {
            name: 'Refactor Widget Manager Factory',
            interval: {
                start: '2023-09-27',
                end: '2023-10-11',
            },
            swimlaneId: '1',
        },
        {
            name: 'Attend meetings',
            interval: {
                start: '2023-10-02',
                end: '2023-10-20',
            },
            swimlaneId: '2',
        },
        {
            name: 'Wait for other people',
            interval: {
                start: '2023-09-28',
                end: '2023-10-27',
            },
            swimlaneId: '3',
        },
    ]
}

function addDays(date, days) {
    const ret = new Date(date);
    ret.setDate(ret.getDate() + days);
    return ret;
}

function diffDays(date1, date2) {
    return Math.ceil((date2 - date1) / (1000 * 60 * 60 * 24));
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

const DEFAULT_WIDTH = 800;
const DEFAULT_USE_DATE_LABELS = true;
const DEFAULT_FONT = 'sans-serif';

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
