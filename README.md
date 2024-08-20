# Gantt Chart Tool
A simple, free (MIT), offline tool to optimize timelines and render Gantt charts.

### Features
* Define your timelines in a JSON DSL ([schema](https://github.com/garyg1/gantt-chart-tool/blob/main/schema.json)).
* Automatically schedule your timelines based on task estimates and dependencies. The optimization runs locally in your browser via Microsoft Z3 Theorem Prover.
* Optional Google Fonts integration - use Google Fonts by specifying `googleFont`. Confirmation popup before making any external network calls. This feature is entirely optional.

### Licensing & Credit
MIT

Dependencies: Microsoft Z3 Prover WASM (MIT), D3.js (ISC), and Monaco editor (MIT). Vendored in this repo.

We used the approach found in [this CodePen](https://codepen.io/jey/pen/nOEeME) to structure the SVG.

#### Comparison with other free tools
There are a lot of excellent free tools to render Gantt charts via a DSL (but not necessarily to schedule them).
- [Vega implementation](https://github.com/PBI-David/Deneb-Showcase) (David Bacci)
- [PlantUML](https://plantuml.com/gantt-diagram)

The choice to create our own simple JSON DSL (rather than extend e.g., Vega) was deliberate. This tool has a single purpose. Minimizing dependencies gives us complete control. There is opportunity to make the experience simpler and clearer when we don't try to fit in a larger framework.

### Usage
A rendered timeline scheduled by the tool. The sample project contains a graph of interdependent tasks. Some tasks are given fixed dates using `interval`. Dependencies can cross workgroup/swimlane boundaries.

![An example timeline, showing a sample project with interdependent tasks](docs/images/Project%20A.timeline.2024-08-17.png)

A confirm popup is displayed before this tool makes any external network calls (Google Fonts). The Google Fonts feature is entirely optional - you can use system fonts offline.

![Google Fonts popup displayed](docs/images/Google%20Fonts%20consent%20popup.png)
