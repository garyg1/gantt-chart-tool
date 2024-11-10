# Gantt Chart Auto-scheduling Tool
A simple, free (MIT), offline tool to auto-schedule timelines and render Gantt charts.

### Features
* Define your timelines in a JSON DSL ([schema](https://github.com/garyg1/gantt-chart-tool/blob/main/schema.json)).
* Automatically schedule your timelines based on task estimates and dependencies. The optimization runs locally in your browser via Microsoft Z3 Theorem Prover.
* Optional Google Fonts integration - use Google Fonts by specifying `googleFont`. Confirmation popup before making any external network calls. This feature is entirely optional.

### Licensing & Discussion
MIT

This repo is self-contained. Dependencies are Microsoft Z3 Prover WASM (MIT), D3.js (ISC), and Monaco editor (MIT). We used the approach found in [this CodePen](https://codepen.io/jey/pen/nOEeME) to structure the SVG.

#### Comparison with other free tools
There are a lot of excellent free tools to render Gantt charts via a DSL (but not necessarily to schedule them).
- [Vega implementation](https://github.com/PBI-David/Deneb-Showcase) (David Bacci)
- [PlantUML](https://plantuml.com/gantt-diagram)

The choice to create our own simple JSON DSL (rather than extend e.g., Vega) was deliberate. This tool has a single purpose. Minimizing dependencies gives us complete control. There is opportunity to make the experience simpler and clearer when we don't try to fit into a larger framework or abstraction layer, which is what this tool tries to achieve.

#### Optional Google Fonts Integration
A confirmation popup is displayed before this tool makes any external network calls (Google Fonts). The Google Fonts feature is entirely optional - you can use system fonts offline.

![Google Fonts popup displayed](docs/images/Google%20Fonts%20consent%20popup.png)

### Usage Examples
The below examples are timelines scheduled and rendered by the tool. The sample project contains a graph of interdependent tasks. Some tasks are given fixed dates using `interval`. Dependencies can cross workgroup/swimlane boundaries.

![An example timeline, showing a sample project with interdependent tasks](docs/images/Project%20A.timeline.2024-11-11.Basic.png)

[docs/examples/Basic-Example.json](docs/examples/Basic-Example.json) (Font: Atkinson Hyperlegible)

![Another example timeline, showing different options for color configuration](docs/images/Project%20A.timeline.2024-11-11.Dark.png)

[docs/examples/Dark-Example.json](docs/examples/Dark-Example.json) (Font: Space Grotesk)

This tool aims to be simple and customizable. A variety of styling options are supported.

![Another example timeline, showing different options for color configuration](docs/images/Project%20A.timeline.2024-11-11.Colorful.png)

[docs/examples/Colorful-Example.json](docs/examples/Colorful-Example.json) (Font: Atkinson Hyperlegible)

![Another example timeline, showing different options for font and spacing configuration](docs/images/Project%20A.timeline.2024-11-11.Yarndings.png)

[docs/examples/Yarndings-20-Example.json](docs/examples/Yarndings-20-Example.json) (Font: Yarndings 20)

Unicode is fully supported and the tool makes few assumptions about localization.
![Another example timeline, showing full unicode support](docs/images/スケジュール例.timeline.2024-11-11.Noto-Sans.png)

[docs/examples/Noto-Sans-Example.json](docs/examples/Noto-Sans-Example.json) (Font: Noto Sans Japanese)