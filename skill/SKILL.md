---
name: idef0
description: Writes IDEF0 function models in the idef0 text language (.idef0 files), which compiles them to IDEF0 diagrams in PDF. Use when asked to model a process, system or business function in IDEF0, or to write, extend or fix a .idef0 file.
---

# Writing IDEF0 models

IDEF0 shows what a system does as boxes (activities) joined by arrows. An arrow's role is the
side of the box it touches:

| Keyword     | Side   | What it is                                             | Example           |
| ----------- | ------ | ------------------------------------------------------ | ----------------- |
| `input`     | left   | what the activity uses up or transforms                | Flour, Raw Timber |
| `control`   | top    | what steers it without being used up: rules, plans     | Recipe, Budget    |
| `output`    | right  | what it produces                                       | Bread, Invoice    |
| `mechanism` | bottom | who or what does the work: people, tools, systems      | Baker, Oven       |

Name activities with a verb phrase ("Bake Bread") and arrows with a noun phrase ("Fresh Bread").

## How to build a model

1. Decide the purpose (why the model exists) and the viewpoint (whose view it takes).
2. Write one top activity for the whole system, with every arrow that crosses its boundary.
3. Break it into 3 to 6 sub-activities, in the order the work flows. Break those down the same
   way where more detail helps.
4. Join the sub-activities by giving an output and the arrows it feeds the same label.

## Example

```idef0
title     "Neighbourhood Bakery"
status    draft
purpose   "Show how orders and ingredients become delivered bread"
viewpoint "Bakery owner"

activity "Run Bakery" {
  input     "Flour", "Customer Order"
  control   "Recipes", "Food Safety Rules"
  output    "Delivered Bread"
  mechanism "Bakers", "Oven"

  activity "Plan Baking" {
    input     "Customer Order"
    control   "Recipes", "Customer Feedback"
    output    "Baking Plan"
    mechanism "Bakers"
  }

  activity "Bake Bread" {
    input     "Flour"
    control   "Baking Plan", "Food Safety Rules"
    output    "Fresh Bread"
    mechanism "Bakers", "Oven"
  }

  activity "Deliver Bread" {
    input     "Fresh Bread"
    control   "Customer Order"
    output    "Delivered Bread", "Customer Feedback"
    mechanism "Bakers", ("Delivery Van")
  }
}
```

## Syntax

- Settings come first, one per line: `title`, `author`, `project`, `date`, `rev`, `status`
  (`working`, `draft`, `recommended` or `publication`), `purpose`, `viewpoint` and `page`
  (`A4`, `A3`, `letter` or `tabloid`).
- Then exactly one top-level `activity`. An activity nested inside another is part of its
  decomposition. There can be at most 9 at one level.
- Inside an activity, `input`, `control`, `output` and `mechanism` (or `I`, `C`, `O`, `M`) are
  followed by labels separated by commas.
- Labels go in double quotes. `\n` breaks a label into lines in the drawing.
- Comments start with `#`. Use `;` to put several statements on one line:
  `activity "Slice Bread" { input "Bread"; control "Order"; output "Slices" }`.

## How arrows connect

Within one decomposition (an activity and its direct sub-activities), arrows connect by label:

- An output of a sub-activity goes to every input, control or mechanism of a sibling with the
  same label.
- An input, control or mechanism of the parent goes to the sub-activities that use the same
  label, on any side.
- An output of the parent comes from the sub-activities that produce it.

Every arrow must connect, or the model does not compile:

- every input, control and mechanism of a sub-activity needs a source: a sibling's output or an
  arrow of the parent;
- every output of a sub-activity must be used by a sibling or be an output of the parent;
- every arrow of the parent must be used, or produced, by a sub-activity.

An arrow in parentheses is tunneled. On a sub-activity, `mechanism ("Delivery Van")` means the
arrow comes from outside the parent, so the parent does not list it. On an activity that has
sub-activities, it means the arrow is left out of the decomposition.

## Before you finish

- Every activity has at least one control and at least one output.
- Each label is spelled the same way everywhere it appears.
- Something that is changed or used up is an input; a rule or plan that only steers is a control.
- Feedback is fine: a later step's output can control an earlier step, as "Customer Feedback"
  does in the example.
- If the `idef0` command is available, run `idef0 --check model.idef0`. It reports every problem
  with its line number and a hint.
