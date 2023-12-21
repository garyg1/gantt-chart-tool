const container = document.getElementById('container');
const monacoContainer = document.getElementById('monaco-container');

var timeline = {
    title: 'Project A',
    swimlanes: [
        {
            id: '1',
            name: 'Coding Tasks',
            color: '#0071c5'
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
            id: '1',
            name: 'Create Widgets',
            interval: {
                start: '2023-10-01',
                end: '2023-10-05',
            },
            swimlaneId: '1',
        },
        {
            id: '2',
            name: 'Implement Widget Factory',
            interval: {
                start: '2023-10-10',
                end: '2023-10-15',
            },
            swimlaneId: '1',
        },
        {
            id: '3',
            name: 'Refactor Widget Manager Factory',
            interval: {
                start: '2023-09-27',
                end: '2023-10-11',
            },
            swimlaneId: '1',
        },
        {
            id: '4',
            name: 'Attend meetings',
            interval: {
                start: '2023-10-02',
                end: '2023-10-20',
            },
            swimlaneId: '2',
        },
        {
            id: '5',
            name: 'Wait for other people',
            interval: {
                start: '2023-09-28',
                end: '2023-10-27',
            },
            swimlaneId: '3',
        },
    ]
}

require.config({ paths: { vs: 'monaco-editor/min/vs' } });
var editor1;
require(['vs/editor/editor.main'], function () {
    const editor = monaco.editor.create(monacoContainer, {
        value: JSON.stringify(timeline, null, 2),
        language: 'json',
        minimap: { enabled: false },
    });
    editor1 = editor;

    editor.getModel().onDidChangeContent(() => {
        const json = editor.getModel().createSnapshot().read();
        timeline = JSON.parse(json);
        rerender();
    });
});

function addDays(date, days) {
    const ret = new Date(date);
    ret.setDate(ret.getDate() + days);
    return ret;
}

function assertTimelineValid(timeline) {
    for (const task of timeline.tasks) {
        if (task.interval.start > task.interval.end) {
            throw new Error(`Task '${task.id}' ('${task.name}') has start > end.`);
        }

        if (!timeline.swimlanes.some(swimlane => swimlane.id == task.swimlaneId)) {
            throw new Error(`Task '${task.id}' ('${task.name}') has invalid swimlane id ${task.swimlaneId}.`)
        }
    }
}

function renderTimeline(timeline) {
    assertTimelineValid(timeline);
    const maxSwimlaneLabelLength = timeline.swimlanes.reduce((max, curr) => Math.max(curr.name.length, max), 0);
    const width = 800;
    const marginRight = 100;
    const marginBottom = 30;
    const datePaddingDays = 5;
    const marginLeft = Math.max(100, maxSwimlaneLabelLength * 8);
    const taskHeight = 15;
    const taskPadding = 5;
    const textPadding = 6;
    const textColor = "black"
    const swimlanePadding = 5;
    const textSize = 12;
    const titleTextSize = 16;
    const titlePaddingTop = 8;
    const titlePaddingBottom = 18;
    const marginTop = 20 + titleTextSize + titlePaddingTop + titlePaddingBottom;
    const height = marginTop
        + timeline.tasks.length * (taskHeight + taskPadding)
        + timeline.swimlanes.length * swimlanePadding;

    timeline = {
        ...timeline,
        tasks: timeline.tasks.slice().sort((a, b) => {
            const intervalStartCmp = a.interval.start.localeCompare(b.interval.start);
            return intervalStartCmp;
        }),
    };

    const minDate = addDays(
        timeline.tasks
            .map(task => task.interval.start)
            .reduce((min, curr) => (!min || curr < min) ? curr : min),
        -datePaddingDays);
    const maxDate = addDays(
        timeline.tasks
            .map(task => task.interval.end)
            .reduce((max, curr) => (!max || curr > max) ? curr : max),
        datePaddingDays);

    let cumulativeTaskIndex = 0
    const perSwimlaneTasks = timeline.swimlanes.map((swimlane, swimlaneIndex) => {
        const tasks = timeline.tasks
            .filter(task => task.swimlaneId == swimlane.id)
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

    // Declare the x (horizontal position) scale.
    const x = d3.scaleUtc()
        .domain([new Date(minDate), new Date(maxDate)])
        .range([marginLeft, width - marginRight])

    // Create the SVG container.
    const svg = d3.create("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("font-family", "sans-serif")

    const title = svg.append("text")
        .text(timeline.title)
        .attr("x", width / 2)
        .attr("y", titleTextSize + titlePaddingTop)
        .attr("font-size", titleTextSize)
        .attr("text-anchor", "middle")

    const xAxisGrid = svg.selectAll('line.horizontalGrid')
        .data(x.ticks(20))
        .enter()
        .append("line")
        .attr("x1", d => x(d))
        .attr("x2", d => x(d))
        .attr("y1", marginTop)
        .attr("y2", height)
        .attr("stroke", "#ccc")

    // Add the x-axis.
    svg.append("g")
        .attr("transform", `translate(0,${marginTop})`)
        .call(d3.axisTop(x))

    for (const { tasks, swimlane } of perSwimlaneTasks) {
        svg.selectAll("mybar")
            .data(tasks)
            .enter()
            .append("rect")
            .attr("x", d => x(new Date(d.interval.start)))
            .attr("y", d => {
                return marginTop + 5
                    + (taskHeight + taskPadding) * d.taskIndexOverall
                    + swimlanePadding * d.swimlaneIndex;
            })
            .attr("width", d => x(new Date(d.interval.end)) - x(new Date(d.interval.start)))
            .attr("height", d => taskHeight)
            .attr("fill", d => d.swimlane.color)

        svg.selectAll("mybar")
            .data(tasks)
            .enter()
            .append("text")
            .attr("x", d => x(new Date(d.interval.end)) + textPadding)
            .attr("y", d => {
                return marginTop + 5
                    + (taskHeight + taskPadding) * d.taskIndexOverall
                    + swimlanePadding * d.swimlaneIndex;
            })
            .attr("dy", d => textSize)
            .attr("font-size", textSize)
            .attr("height", d => taskHeight)
            .attr("fill", textColor)
            .text(d => d.name)
    }

    svg.selectAll("swimlanelabel")
        .data(perSwimlaneTasks.map(p => p.swimlane))
        .enter()
        .append("rect")
        .attr("x", 0)
        .attr("y", d => {
            return marginTop + 5
                + (taskHeight + taskPadding) * d.taskIndexOverall
                + swimlanePadding * d.swimlaneIndex;
        })
        .attr("width", marginLeft - 5)
        .attr("height", d => (taskHeight + taskPadding) * d.numTasks)
        .attr("fill", d => d.color)

    svg.selectAll("swimlanelabel")
        .data(perSwimlaneTasks.map(p => p.swimlane))
        .enter()
        .append("text")
        .text(d => d.name)
        .attr("x", marginLeft / 2 - 2)
        .attr("y", d => {
            return marginTop + 5
                + (taskHeight + taskPadding) * d.taskIndexOverall
                + swimlanePadding * d.swimlaneIndex;
        })
        .attr("dx", 0)
        .attr("dy", d => (taskHeight + taskPadding) * d.numTasks / 2 - taskPadding / 2 + textSize / 2)
        .attr("font-size", textSize)
        .attr("height", d => (taskHeight + taskPadding) * d.numTasks)
        .attr("text-anchor", "middle")
        .attr("fill", "#fff")

    return svg;
}

function rerender() {
    const svg = renderTimeline(timeline);
    while (container.firstChild) {
        container.removeChild(container.lastChild);
    }
    container.append(svg.node());
}

rerender();
