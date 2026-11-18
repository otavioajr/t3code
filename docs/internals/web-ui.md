# Web UI

## Primitives

Controls come from [`components/ui`](../../apps/web/src/components/ui).
[AGENTS.md](../../AGENTS.md#taste) says how to use and extend them.

Don't style a raw `<button>`, `<input>`, `<select>`, or `<textarea>` to look like a control a
primitive provides. Raw elements are right when the element isn't that control: semantic rows, tabs,
resize handles, swatches, editor surfaces, anything whose behavior or geometry differs by design.

## Styles

Style with Tailwind classes in the component that renders the element.

- Global CSS, in [`index.css`](../../apps/web/src/index.css) or any other stylesheet, is only for
  what classes on the owning component can't express: generated Markdown or imperative DOM, custom
  elements and shadow roots, animations, runtime theme variables, and browser or Electron
  integration.
- No `style={{ ... }}` or inline `<style>` for static values a class covers. Values computed at
  runtime are fine.
- Theme-only rules use `@variant dark` and `@variant light`, not `.dark` selectors.

## Composition

The composer banners are the reference.

- [`ComposerBanner.tsx`](../../apps/web/src/components/chat/ComposerBanner.tsx) exports one object
  of small slots. Slots own their classes, take `className`, and spread the rest of their props,
  merging classes with `cn`. Variants and density are props on `Root`. A slot that needs a control
  renders `Button`.
- [`ComposerBannerStack.tsx`](../../apps/web/src/components/chat/ComposerBannerStack.tsx) composes
  the slots and owns only stack behavior: priority, expand and collapse, dismiss transitions.

Build new UI the same way. Compose or extend a component instead of copying its markup and classes.
When a call site repeats a treatment another one already uses, make it a variant or a slot on the
shared component. A new composer banner or notice uses the `ComposerBanner` slots.

## Handlers in large components

V8 gives every closure created in one render a single shared scope. A memoized handler keeps
the scope of the render that created it, and that scope holds the other memoized values of that
render. When handlers in one component change at different times, each keeps an older scope that
holds older handlers, and old renders, with their server config and thread data, stay in memory
for as long as the component is mounted. React Compiler's memoized closures do the same.

In large, long-lived components such as `ChatView` and `ChatComposer`, write handlers as plain
functions and wrap them with [`useStableCallback`](../../apps/web/src/hooks/useStableCallback.ts)
only where they leave the component: props, hook dependency arrays, and effect or memo bodies.
Calls inside the component keep the plain function, so work that resumes after an `await` still
acts on the render it started in. A function that a child calls during render, or after an
`await`, comes from a module-level factory memoized on its inputs, so its closure keeps only
those inputs.

## React Compiler

The compiler memoizes a component or hook only when it can prove the code follows React's rules.
Anything it can't prove, such as reading a ref during render or calling `setState` from an effect,
makes it skip the whole function without a build error. Lint reports each skip as a
`react(...)` warning with the note "React Compiler skipped optimizing this component or hook".

Every file under `apps/web/src` must compile. Lint makes those rules errors there, and
`t3code/no-manual-memo` rejects `useMemo` and `useCallback`, which the compiler makes redundant;
no upstream rule bans them outright. It also rejects `"use memo"`. The compiler withholds a cache
scope when a value reaches plain function calls on both sides of a hook call. A `"use memo"`
helper forces one, but hides the ordering problem. Fix the order instead: plain uses of a value go
before the hook, or the helper is inlined. A `use*` helper that calls no hook is compiled as a
plain function and caches nothing, so a derived-value helper reads its source hook itself instead
of taking the value as an argument. `t3code/no-hookless-use-function` rejects a `use*` function
that calls no hook. Lint misses some bailouts, notably `try` with `finally` and
`throw` inside `try`, so [`reactCompilerCoverage.test.ts`](../../apps/web/src/reactCompilerCoverage.test.ts)
compiles every file and fails on any skip. Async handlers rarely need `try`: an
atom command settles into a result, so cleanup can follow the `await`. `useStableCallback` still
marks handlers that leave a large component, as described above.

## Right panel layout

A thread's right panel is two levels on purpose: columns, each a stack of tab groups. The
[layout model](../../apps/web/src/rightPanelLayoutModel.ts) has no general tree. Every Claude
Desktop-style arrangement fits in two levels, and a fixed depth keeps drop targets, dividers and
restoring a minimized group unambiguous.

The flat `surfaces` registry and `activeSurfaceId` in
[rightPanelStore](../../apps/web/src/rightPanelStore.ts) remain the source of truth for which tabs
exist. Groups hold only ids. Open, close and agent paths keep editing the flat list.
`reconcileRightPanelLayout` then runs after every store update: it drops closed ids, puts new tabs
in the focused group, follows activation into the owning group (restoring a minimized one), and
mirrors the focused group's active tab back into `activeSurfaceId`. New open paths need no layout
code. Code that reads `activeSurfaceId` sees the focused group's active tab, not every visible tab.

Layouts persist per thread in `layoutByThreadKey`. A thread with no stored layout reads as one
column with one group, which is how v15 data migrates. Minimized groups leave `columns` but keep
their tabs in the registry, so closing a card goes through the usual closed-view flow.

Native browser views sit above the DOM and take the pointer. While a tab drag is in progress they
are hidden through `browserSurfaceSuppression`, or drop zones over a browser group would never see
the pointer.

## Split view panes

A [split](../../apps/web/src/splitView/splitViewModel.ts) mounts several full `ChatView`s, and
most chat code was written for one: it listens on `window` and reads `document.activeElement`. The
route stays the single source of focus: the focused pane shows the routed thread, routing to a
thread another pane shows focuses that pane, and pointer-down or focus inside a pane routes to its
thread. An unfocused pane renders under `BackgroundThreadContext`, so listeners gated for Settings
already stand down there; listeners gated only on `embedded` use the pane's `standDown` instead.

A window listener inside a chat must also pass `chatPaneOwnsTarget`: it acts on events from inside
its own pane, and on events from outside every pane only when its pane has focus. Without that, a key
pressed in one pane before its focus claim lands reaches the other pane's composer. Module-level
singletons keyed by thread (thread find timelines, chat overlays) must hold one entry per shown
thread, not one for the app.
