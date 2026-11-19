# idef0-dsl

A small text language for [IDEF0](https://en.wikipedia.org/wiki/IDEF0) function models, and a
compiler that turns a model into a PDF. You write activities and their arrows; the compiler
connects the arrows, checks the model against IDEF0 rules, lays out every diagram and draws it
on the standard IDEF0 form.

```idef0
title  "Custom Furniture Workshop"
status draft

activity "Make Custom Furniture" {
  input     "Customer Order", "Raw Timber"
  control   "Building Codes", "Budget"
  output    "Delivered Furniture", "Invoice"
  mechanism "Carpenters", "Workshop Tools"

  activity "Design Piece" {
    input     "Customer Order"
    control   "Building Codes"
    output    "Drawings"
    mechanism "Carpenters"
  }
  # ... more sub-activities
}
```

```sh
idef0 examples/workshop.idef0      # writes examples/workshop.pdf
```

The PDF has one page per diagram: the A-0 context diagram first, then each decomposition in
node order (A0, A1, A11, …). See [examples/workshop.idef0](examples/workshop.idef0) and the PDF
made from it, [examples/workshop.pdf](examples/workshop.pdf).

## Install

You need Node.js 22.18 or later. The package is not published to npm; set it up from this
folder:

```sh
npm install
npm run build     # compiles src/ to dist/
npm link          # optional: puts the idef0 command on your PATH
```

Without `npm link`, run `npm exec idef0 -- model.idef0` inside this folder. You can also run
`node src/cli.ts model.idef0`, which runs the TypeScript sources directly and needs no build.
Other projects can depend on the folder with `npm install /path/to/idef0`.

## The language

### Activities and arrows

An `activity` is a box. Its body lists the arrows on each of its four sides, by ICOM role:

| Keyword     | Short forms         | Side of the box |
| ----------- | ------------------- | --------------- |
| `input`     | `inputs`, `in`, `I` | left            |
| `control`   | `controls`, `ctrl`, `C` | top         |
| `output`    | `outputs`, `out`, `O` | right         |
| `mechanism` | `mechanisms`, `mech`, `M` | bottom    |

Separate several labels with commas. A role can appear more than once; `;` between statements
is optional, so short activities fit on one line:

```idef0
activity "Bake" { input "Dough"; control "Recipe"; output "Bread"; mechanism "Oven", "Baker" }
```

Labels are strings in double quotes. A label that is a single word may go without quotes.
Inside a string, `\n` forces a line break in the drawn label, and `\"` and `\\` write a quote
and a backslash. A string ends on the line it starts on.

Comments are `# …`, `// …` and `/* … */`. `function` is accepted as a synonym of `activity`.

### Decomposition and how arrows connect

Nesting activities decomposes the outer one: its sub-activities become the boxes of its own
diagram. The file has exactly one top-level activity, the A0 function. Node numbers follow from
the nesting: the children of A0 are A1, A2, …, the children of A3 are A31, A32, … You may write
a node number before a name (`activity A2 "Prepare Materials"`) and the compiler checks it.

Arrows connect **by label**. Within one decomposition:

- an output of one sub-activity connects to every input, control or mechanism of a sibling
  with the same label. One source and several destinations draws as a fork; several sources
  and one destination draws as a join;
- an input, control or mechanism of the parent comes in from the edge of the diagram (the
  frame) to the sub-activities that use it;
- an output of the parent leaves through the right edge, from the sub-activities that produce it.

Matching ignores case, extra spaces and line breaks. If the same arrow is spelled differently
in two places, the compiler warns you, because the diagram can show only one spelling.

Every arrow has to go somewhere. A sub-activity input with no source, an output nobody uses, or
a parent arrow that no sub-activity picks up is an error. The error message suggests the closest
existing label when you have probably mistyped one.

### Tunneled arrows

Put a label in parentheses to tunnel the arrow: it is drawn with IDEF0's parentheses and is
exempt from the connection rules at one level.

- On an activity that has a decomposition, `control ("Safety Rules")` means the arrow is not
  shown on the decomposition. The parentheses are drawn at the box end.
- On a sub-activity, `mechanism ("Spray Booth")` means the arrow comes from outside the
  parent: it enters at the frame, parentheses at the frame end, with no ICOM code. A tunneled
  output leaves through the frame the same way.

```idef0
activity "Sand and Finish" {
  input     "Frame"
  control   "Drawings", ("Finish Spec")
  output    "Finished Frame"
  mechanism "Carpenters", ("Spray Booth")
}
```

### Settings

Settings go at the top of the file, one per line:

| Setting     | Used for                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `title`     | PDF title; also the PROJECT field when `project` is not set              |
| `author`    | AUTHOR field                                                             |
| `project`   | PROJECT field                                                            |
| `date`      | DATE field                                                               |
| `rev`       | REV field                                                                |
| `status`    | `working` (default), `draft`, `recommended` or `publication`, ticked in the header |
| `purpose`   | printed under the A-0 diagram                                            |
| `viewpoint` | printed under the A-0 diagram                                            |
| `page`      | `A4` (default), `A3`, `letter` or `tabloid`, always landscape            |
| `font`      | a TrueType/OpenType file for all text, relative to the model file        |

## What the PDF shows

Each page is an IDEF0 diagram on the standard form:

- **Header:** USED AT, AUTHOR, PROJECT, NOTES 1–10, DATE, REV, the status boxes, READER and
  DATE. The CONTEXT cell shows the parent diagram in miniature with this diagram's box filled
  in, or "TOP" on A-0.
- **Footer:** NODE, TITLE (the name of the activity being decomposed) and NUMBER (`page / pages`).
- **Boxes** are placed on a diagonal "staircase", with their box numbers in the lower right
  corner.
- **Arrows** are routed automatically with rounded bends. Forks and joins share their common
  line. Feedback to a control goes over the top; feedback to an input or mechanism goes
  underneath.
- **ICOM codes** (I1, C2, O1, M1, …) mark each boundary arrow with its position on the parent
  box.
- **Tunnels** are drawn with parentheses.
- **Detail references** (`p. 3`) appear under a box that has its own decomposition.

Codes are kept in order along each edge (I1 above I2, C1 left of C2) wherever that costs no
crossings.

The PDF also has links: click a decomposed box to go to its diagram, or the CONTEXT cell to go
to the parent. The bookmarks list every diagram.

Text uses the built-in Helvetica when every character fits its encoding. For other scripts
(Cyrillic, Greek, CJK, …) the compiler embeds a Unicode font it finds on the system (DejaVu,
Noto or Liberation Sans on Linux, Arial on macOS and Windows). If it finds none, pass one with
`--font` or the `font` setting.

The layout is automatic; there is no manual positioning. A diagram can have at most 9 boxes,
and IDEF0 recommends 3 to 6. Diagrams that do not fit the page at full size are scaled down.

## Command line

```
Usage: idef0 <model.idef0> [options]

Options:
  -o, --output <file>  PDF to write (default: the input name with .pdf)
      --page <size>    page size: A4, A3, letter, tabloid (default: the model's, else A4)
      --font <file>    TrueType/OpenType font for all text (for scripts Helvetica lacks)
      --check          check the model and report problems, but write nothing
  -h, --help           show this help
  -v, --version        show the version
```

Problems are reported the way compilers report them, with the line, the source and a hint:

```
model.idef0:40:17: error: input "Cut Part" of A31 "Assemble Frame" has no source: no activity in A3 outputs it, and A3 does not take it as an input, control or mechanism
  40 |       input     "Cut Part"
     |                 ^^^^^^^^^^
  = hint: did you mean "Cut Parts"?
```

Warnings point out things IDEF0 discourages but that still compile, such as an activity without
a control or a decomposition with fewer than 3 boxes. The exit code is 0 on success (warnings
included), 1 when the model has errors or a file cannot be read or written, and 2 for wrong usage.

## Web editor

```sh
npm run web            # opens the editor at http://localhost:5173
```

The editor shows the model source on the left and the PDF on the right, redrawn as you type,
with a **Download PDF** button. Problems are listed under the source; click one to jump to it.
While the source has errors, the last good PDF stays on screen, dimmed.

Everything runs in the browser, so `npm run web:build` makes a static site in `web/dist/` that
any static host can serve. `npm run web:preview` serves that build locally.

## TypeScript API

```ts
import { writeFile } from 'node:fs/promises';
import { compile } from 'idef0-dsl';

const { pdf, warnings } = await compile(source);   // source: the text of a .idef0 file
await writeFile('model.pdf', pdf);
```

`compile(source, options?)` returns `{ pdf, model, layouts, warnings }` and throws an
`Idef0Error` whose `diagnostics` list every problem. Print them with
`formatDiagnostic(diagnostic, source, fileName)`. The options are `page`, `font`, `boldFont`,
`baseDir` (the folder a relative `font` setting is relative to) and `style` (layout sizes and
font sizes; see `DEFAULT_STYLE`). `check(source)` validates a model without rendering it.

### Building models in code

Instead of text, you can build the model with functions and compile that:

```ts
import { activity, compile, model, toSource, tunnel } from 'idef0-dsl';

const doc = model(
  { title: 'Tea', status: 'draft' },
  activity('Make Tea', { input: ['Water', 'Tea Leaves'], control: 'Recipe', output: 'Cup of Tea', mechanism: 'Kettle' }, [
    activity('Boil Water', { input: 'Water', control: 'Recipe', output: 'Hot Water', mechanism: 'Kettle' }),
    activity('Steep', { input: ['Hot Water', 'Tea Leaves'], control: ['Recipe', tunnel('Taste')], output: 'Brewed Tea', mechanism: 'Kettle' }),
    activity('Serve', { input: 'Brewed Tea', control: 'Recipe', output: 'Cup of Tea', mechanism: 'Kettle' }),
  ]),
);

const { pdf } = await compile(doc);
const text = toSource(doc);   // the same model as .idef0 source
```

`activity(name, arrows, children)` takes one label or an array per role. `tunnel(label)` marks
a tunneled arrow, and `model(settings, top)` takes the settings listed above. The checks and
error messages are the same as for text, without line numbers.

### Lower-level pieces

Each stage is exported on its own, for example to render diagrams some other way:

| Function                  | Does                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `parse(source)`           | text → syntax tree (`DocumentAst`)                                         |
| `analyze(ast)`            | syntax tree → checked `Model` with one `DiagramSpec` per diagram, plus warnings |
| `layoutModel(model, opts)` | lays out every diagram: box rectangles, arrow polylines, label and code positions |
| `renderPdf(model, opts)`  | the PDF                                                                    |

## Development

```sh
npm test            # type-check, then run the tests
npm run build       # compile to dist/
```

The sources are in `src/`:

| File             | Contents                                                        |
| ---------------- | --------------------------------------------------------------- |
| `lexer.ts`       | tokenizer                                                       |
| `parser.ts`      | parser                                                          |
| `model.ts`       | semantic checks: node numbers, connecting arrows by label, tunnels |
| `layout.ts`      | layout: box placement, routing, port order, labels              |
| `strokes.ts`     | splitting shared fork and join lines                            |
| `pdf.ts`         | the IDEF0 form and drawing                                      |
| `builder.ts`     | the TypeScript builder and `toSource`                           |
| `browser.ts`     | the library entry point without Node                            |
| `fonts.ts`       | finding fonts on disk (Node)                                    |
| `index.ts`       | the library entry point for Node                                |
| `cli.ts`         | the command                                                     |

The web editor is in `web/`.

## License

MIT. See [LICENSE](LICENSE).
