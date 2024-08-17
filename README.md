# Gantt Chart Tool
A free (MIT), offline, JSON-based Gantt chart maker with minimal dependencies.

### Features
* Define your timelines in a JSON DSL ([schema](https://github.com/garyg1/gantt-chart-tool/blob/main/schema.json)).
* Automatically schedules your timelines based on your estimates. The optimization runs locally in your browser via Microsoft Z3 Theorem Prover.
* Optional Google Fonts integration - use Google Fonts by specifying `googleFont`. Confirmation popup before making any external network calls. This feature is entirely optional.

### Licensing & Credit
MIT

Dependencies: Microsoft Z3 Prover WASM (MIT), d3 (ISC), and Monaco editor (MIT). Vendored in this repo.

We used the approach found in [this CodePen](https://codepen.io/jey/pen/nOEeME) to structure the SVG.

### Usage
An example timeline, showing a sample project with a random DAG of interdependent tasks crossing workgroup/swimlane boundaries.

![An example timeline, showing a sample project with interdependent tasks](docs/images/Project%20A.timeline.2024-08-17.png)

A confirm popup is displayed before this tool makes any external network calls (Google Fonts). The Google Fonts feature is entirely optional - you can use system fonts offline.

![Google Fonts popup displayed](docs/images/Google%20Fonts%20consent%20popup.png)