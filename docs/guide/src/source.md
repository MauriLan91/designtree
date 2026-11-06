# Editing the DTS source

The DTS source panel shows the design as devicetree source, with syntax
highlighting, and you can edit it. A short pause after you type, the text is
parsed and the canvas follows; edits on the canvas update the text. Nodes
keep their place on the canvas when you change them in the text.

Selection follows both ways: selecting a node scrolls the text to it, and
moving the cursor into a node's block selects the node. While the text does
not parse, the error is shown and the canvas keeps the last valid design.
