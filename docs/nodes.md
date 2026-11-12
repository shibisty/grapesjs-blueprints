# Blocks reference

Generated from the node registry (`scripts/gen-nodes.mjs`). Pin types: `exec` (order of execution), `string`, `number`, `boolean`, `element`, `elements`, `event`, `object`, `any`. A text value on an element pin is a CSS selector.

## Events

### On element event — `event.element`

Runs when an event happens on an element matching the selector — on every page, also for elements added later (the listener is delegated to the document). Without a selector: the blueprint root itself (the component element).

- **Inputs:** —
- **Outputs:** `exec`, `element` Element, `event` Event
- **Settings:** Selector (`selector`), Event (`event` = `"click"`; `click` `dblclick` `contextmenu` `mousedown` `mouseup` `mouseenter` `mouseleave` `pointerdown` `pointerup` `touchstart` `touchend` `input` `change` `submit` `reset` `focus` `blur` `keydown` `keyup` `animationend` `transitionend`), Prevent default (`preventDefault` = `false`), Stop propagation (`stopPropagation` = `false`), Only once (`once` = `false`)

### On start — `event.start`

Runs once when the blueprint starts: when the page is ready, or when a component instance appears.

- **Inputs:** —
- **Outputs:** `exec`, `element` Root

### On page event — `event.page`

Window / document events: load, scroll, resize, hash change, tab visibility…

- **Inputs:** —
- **Outputs:** `exec`, `event` Event
- **Settings:** Event (`event` = `"scroll"`; `load` `scroll` `resize` `hashchange` `popstate` `visibilitychange` `online` `offline` `beforeunload`), Throttle, ms (`throttle` = `0`)

### On timer — `event.timer`

Runs after a delay, or every N milliseconds when "Repeat" is on.

- **Inputs:** —
- **Outputs:** `exec`
- **Settings:** Milliseconds (`ms` = `1000`), Repeat (`repeat` = `false`)

### On key — `event.key`

Runs when a key is pressed anywhere on the page (for example Escape). Empty key = any key.

- **Inputs:** —
- **Outputs:** `exec`, `event` Event
- **Settings:** Key (`key` = `"Escape"`; `Escape` `Enter` ` ` `ArrowLeft` `ArrowRight` `ArrowUp` `ArrowDown` `Tab`), Event (`event` = `"keydown"`; `keydown` `keyup`), Ctrl / ⌘ (`ctrl` = `false`), Shift (`shift` = `false`), Alt (`alt` = `false`), Prevent default (`preventDefault` = `false`)

### On custom event — `event.custom`

Runs when a custom event with this name reaches the blueprint root (see "Send event"). Lets blueprints talk to each other.

- **Inputs:** —
- **Outputs:** `exec`, `any` Data, `element` Sender
- **Settings:** Event name (`name` = `"my-event"`)

## Flow

### Branch — `flow.branch`

If the condition is true, runs "True", otherwise "False".

- **Inputs:** `exec`, `boolean` Condition = `false`
- **Outputs:** `exec` True, `exec` False

### Sequence — `flow.sequence`

Runs the outputs one after another, top to bottom.

*pins depend on the settings*

- **Inputs:** `exec`
- **Outputs:** `exec` Then 0, `exec` Then 1
- **Settings:** Outputs (`count` = `2`)

### Delay — `flow.delay`

Waits, then continues.

- **Inputs:** `exec`, `number` Milliseconds = `300`
- **Outputs:** `exec`

### Debounce — `flow.debounce`

Continues only after calls stop for the given time (typing, resizing).

- **Inputs:** `exec`, `number` Milliseconds = `300`
- **Outputs:** `exec`

### Throttle — `flow.throttle`

Continues at most once per the given time.

- **Inputs:** `exec`, `number` Milliseconds = `200`
- **Outputs:** `exec`

### Do once — `flow.doOnce`

Continues only the first time, until "Reset" is run.

- **Inputs:** `exec`, `exec` Reset
- **Outputs:** `exec`

### For each — `flow.forEach`

Runs "Loop body" for every item (elements found by a selector, an array…), then "Completed".

- **Inputs:** `exec`, `any` Items
- **Outputs:** `exec` Loop body, `any` Item, `number` Index, `exec` Completed

### Switch — `flow.switch`

Runs the output whose case equals the value, otherwise "Default". Cases are comma-separated.

*pins depend on the settings*

- **Inputs:** `exec`, `any` Value
- **Outputs:** `exec` a, `exec` b, `exec` Default
- **Settings:** Cases (`cases` = `"a, b"`)

## Dom

### Find elements — `dom.query`

Finds elements by a CSS selector: in the whole document (or component), inside the given elements, or the closest ancestor of them.

- **Inputs:** `string` Selector, `elements` From
- **Outputs:** `elements` Elements, `element` First, `number` Count
- **Settings:** Where (`mode` = `"all"`; `all` `within` `closest`)

### Root element — `dom.root`

The component element (component blueprints) or <html> (page blueprints).

- **Inputs:** —
- **Outputs:** `element` Element

### Add class — `dom.addClass`

Adds class(es) to the elements. Several classes: separate with spaces.

- **Inputs:** `exec`, `elements` Target, `string` Class
- **Outputs:** `exec`

### Remove class — `dom.removeClass`

Removes class(es) from the elements.

- **Inputs:** `exec`, `elements` Target, `string` Class
- **Outputs:** `exec`

### Toggle class — `dom.toggleClass`

Adds the class if it is missing, removes it otherwise.

- **Inputs:** `exec`, `elements` Target, `string` Class
- **Outputs:** `exec`

### Has class — `dom.hasClass`

True if any of the elements has the class.

- **Inputs:** `elements` Target, `string` Class
- **Outputs:** `boolean` Result

### Matches selector — `dom.matches`

True if the element matches the CSS selector (e.g. the click was on the backdrop itself).

- **Inputs:** `element` Element, `string` Selector
- **Outputs:** `boolean` Result

### Set attribute — `dom.setAttribute`

Sets an attribute (aria-expanded, data-state…).

- **Inputs:** `exec`, `elements` Target, `string` Name, `string` Value
- **Outputs:** `exec`

### Remove attribute — `dom.removeAttribute`

Removes an attribute.

- **Inputs:** `exec`, `elements` Target, `string` Name
- **Outputs:** `exec`

### Get attribute — `dom.getAttribute`

Attribute of the first element (empty string if missing).

- **Inputs:** `elements` Target, `string` Name
- **Outputs:** `string` Value

### Set style — `dom.setStyle`

Sets an inline CSS property (empty value removes it).

- **Inputs:** `exec`, `elements` Target, `string` Property, `string` Value
- **Outputs:** `exec`

### Set text — `dom.setText`

Replaces the text of the elements (safe: no HTML is parsed).

- **Inputs:** `exec`, `elements` Target, `string` Text
- **Outputs:** `exec`

### Get text — `dom.getText`

Text of the first element.

- **Inputs:** `elements` Target
- **Outputs:** `string` Text

### Set HTML (unsafe) — `dom.setHtml`

Replaces the inner HTML. Never pass user input here: it can run scripts (XSS). Prefer "Set text".

- **Inputs:** `exec`, `elements` Target, `string` HTML
- **Outputs:** `exec`

### Get value — `dom.getValue`

Value of the first form field (checkbox: checked or not).

- **Inputs:** `elements` Target
- **Outputs:** `any` Value

### Set value — `dom.setValue`

Sets the value of form fields (checkbox: checks when the value is truthy).

- **Inputs:** `exec`, `elements` Target, `any` Value
- **Outputs:** `exec`

### Show — `dom.show`

Makes hidden elements visible (removes display: none / hidden).

- **Inputs:** `exec`, `elements` Target
- **Outputs:** `exec`

### Hide — `dom.hide`

Hides the elements (display: none).

- **Inputs:** `exec`, `elements` Target
- **Outputs:** `exec`

### Show / hide — `dom.toggleVisible`

Shows hidden elements and hides visible ones.

- **Inputs:** `exec`, `elements` Target
- **Outputs:** `exec`

### Is visible — `dom.isVisible`

True if the first element is displayed.

- **Inputs:** `elements` Target
- **Outputs:** `boolean` Result

### Focus — `dom.focus`

Moves keyboard focus to the element.

- **Inputs:** `exec`, `elements` Target
- **Outputs:** `exec`

### Scroll to — `dom.scrollIntoView`

Scrolls the page to the element.

- **Inputs:** `exec`, `elements` Target, `boolean` Smooth = `true`
- **Outputs:** `exec`

### Send event — `dom.dispatch`

Sends a custom event from the elements (bubbles). Other blueprints catch it with "On custom event". Empty target = blueprint root.

- **Inputs:** `exec`, `elements` Target, `string` Event name = `"my-event"`, `any` Data
- **Outputs:** `exec`

### Prevent default — `event.preventDefault`

Stops the browser action of the event (following a link, submitting a form).

- **Inputs:** `exec`, `event` Event
- **Outputs:** `exec`

### Event target — `event.target`

The element the event actually happened on (may be a child of the listened element).

- **Inputs:** `event` Event
- **Outputs:** `element` Target

## Data

### Text — `data.string`

A string value.

- **Inputs:** `string` Value
- **Outputs:** `string` Value

### Number — `data.number`

A number value.

- **Inputs:** `number` Value = `0`
- **Outputs:** `number` Value

### Boolean — `data.boolean`

A boolean value.

- **Inputs:** `boolean` Value = `false`
- **Outputs:** `boolean` Value

### Join text — `string.concat`

Joins two texts with an optional separator.

- **Inputs:** `string` A, `string` B, `string` Separator
- **Outputs:** `string` Result

### To number — `convert.number`

Converts a value to a number (0 if it is not a number).

- **Inputs:** `any` Value
- **Outputs:** `number` Number

### To text — `convert.string`

Converts a value to text (objects as JSON).

- **Inputs:** `any` Value
- **Outputs:** `string` Text

### Read from storage — `storage.get`

Value saved in the browser (localStorage) under the key; empty text if none.

- **Inputs:** `string` Key
- **Outputs:** `string` Value

### Save to storage — `storage.set`

Saves a value in the browser (localStorage); it survives reloads.

- **Inputs:** `exec`, `string` Key, `string` Value
- **Outputs:** `exec`

### Object (JSON) — `data.object`

An object or array written as JSON — for library options: `{ "loop": true, "speed": 600 }`.

- **Inputs:** —
- **Outputs:** `object` Object
- **Settings:** JSON (`json`)

## Variables

### Get variable — `var.get`

Value of a blueprint variable.

- **Inputs:** —
- **Outputs:** `any` Value
- **Settings:** Variable (`variable`)

### Set variable — `var.set`

Stores a value in a blueprint variable (kept while the page is open).

- **Inputs:** `exec`, `any` Value
- **Outputs:** `exec`, `any` Value
- **Settings:** Variable (`variable`)

### Component parameter — `component.param`

Value of a component parameter (set in the component traits). Component blueprints only.

- **Inputs:** —
- **Outputs:** `any` Value
- **Settings:** Parameter (`param`)

## Math

### Math — `math.op`

Arithmetic on two numbers. Division by zero gives 0.

- **Inputs:** `number` A = `0`, `number` B = `0`
- **Outputs:** `number` Result
- **Settings:** Operation (`op` = `"+"`; `+` `-` `*` `/` `%` `min` `max` `pow`)

## Logic

### Compare — `logic.compare`

Compares two values. "==" compares loosely ("1" equals 1).

- **Inputs:** `any` A, `any` B
- **Outputs:** `boolean` Result
- **Settings:** Operator (`op` = `"=="`; `==` `!=` `<` `>` `<=` `>=`)

### AND — `logic.and`

True if both are true.

- **Inputs:** `boolean` A = `false`, `boolean` B = `false`
- **Outputs:** `boolean` Result

### OR — `logic.or`

True if at least one is true.

- **Inputs:** `boolean` A = `false`, `boolean` B = `false`
- **Outputs:** `boolean` Result

### NOT — `logic.not`

Inverts a boolean.

- **Inputs:** `boolean` Value = `false`
- **Outputs:** `boolean` Result

## Code

### JavaScript — `code.js`

Your own code. Inputs come in `inputs`, return an object with the outputs (`return { result: 42 };`). `ctx` has `root`, `document`, `window`, `params`. With "Async", return a Promise: the chain continues when it resolves.

*pins depend on the settings*

- **Inputs:** `exec`, `any` value
- **Outputs:** `exec`, `any` result
- **Settings:** Code (`code`), Inputs (`inputs` = `[{"id":"value","type":"any"}]`), Outputs (`outputs` = `[{"id":"result","type":"any"}]`), Async (`async` = `false`)

### Expression — `code.expression`

A JavaScript expression of `a` and `b`, e.g. `a * 2 + b` or `a.trim()`.

- **Inputs:** `any` a, `any` b
- **Outputs:** `any` Result
- **Settings:** Expression (`expression`)

### Call function — `lib.call`

Calls a global function, e.g. a library one: `gsap.to`, `AOS.init`, `alert`. Arguments are passed in order.

*pins depend on the settings*

- **Inputs:** `exec`, `any` Argument 1
- **Outputs:** `exec`, `any` Result
- **Settings:** Function (`fn` = `"console.log"`), Arguments (`args` = `1`)

### Create object — `lib.new`

Creates an object of a library class: `new Swiper(element, options)`, `new Chart(canvas, config)`.

*pins depend on the settings*

- **Inputs:** `exec`, `any` Argument 1, `any` Argument 2
- **Outputs:** `exec`, `object` Object
- **Settings:** Class (`cls` = `"Swiper"`), Arguments (`args` = `2`)

### Call method — `lib.method`

Calls a method of an object, e.g. `slideNext` of a Swiper, `play` of a video element.

*pins depend on the settings*

- **Inputs:** `exec`, `any` Object
- **Outputs:** `exec`, `any` Result
- **Settings:** Method (`method`), Arguments (`args` = `0`)

### Global value — `lib.get`

Reads a global value: `location.pathname`, `innerWidth`, a library object.

- **Inputs:** —
- **Outputs:** `any` Value
- **Settings:** Name (`name` = `"location.pathname"`)

## Debug

### Print to console — `debug.log`

Writes a value to the browser console.

- **Inputs:** `exec`, `string` Label, `any` Value
- **Outputs:** `exec`
