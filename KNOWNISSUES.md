* Export to various other timeline tools (PlantUML, Microsoft Project, etc.)
* Fix offline worker I copied for the COEP header.
* Add file loading to offline worker.
* Randomize styles
* The tick labels overlap. The workaround is to resize the chart until they don't. All I have is a hacky workaround - `cullOverlappingTickLabels`. I have a true fix in D3 that I've yet to upstream.
* I do not know what all the [Z3 parameters](https://microsoft.github.io/z3guide/programming/Parameters/#global-parameters) do. If there is a more optimal configuration that optimizes faster or more accurately, that would improve the usefulness of this tool.
