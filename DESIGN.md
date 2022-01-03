# Motivation

This project begins with Card Crawl Adventure - a neat little mobile card game, where the cards you play each turn are
picked from a board by following a path, thus making positioning an additional factor to consider. And so your brain
doesn't explode while trying to process all possible combinations, it gives you a _preview_ of your turn: you see what
picking any given card will do _immediately_, but you're free to undo and alter your choices until you _commit_ to your
turn.

...And that's about all you need to know about the mechanics to understand what's going on here. The reason this project
exists, is that while the above ideas are quite user-friendly, the practical implementation left some things to be
desired. Namely:

- __Path cancelling bugs__: As it turns out, some choices you made during the preview could survive being undone. 
  Certain cards would power up when choosing a longer path, but fail to power down when you changed your mind and chose
  a shorter path. This let you charge up said cards infinitely just by selecting and deselecting the same exact cards
  during the preview.
- __Animations blocking input__: If you tap a card on the board, it'll play a short animation and become selected. If
  you tap an already selected card, it'll play a short animation and become deselected. If you tap a card _while_ it's
  playing its animation, maybe something will happen, and maybe it'll be what you intended. Usually it isn't.
- __Slow animations__: There are unique and clear animations for every interaction you have with the cards, which helps
  understand exactly what's going on. Some are extra weighty and slow to communicate your impending doom! But after a
  billion matches, you'll know exactly what's going on, and will just want to get on with it. 
- __No swipe input__: For some irrational reason, I find swipe inputs to be great fun on a touchscreen. They're not
  supported here, you need to tippity-tap your way through the selection.

Fixing these issues did not seem too hard, but instead of complaining about it on the internets, I thought I'd take a
crack at these problems myself. It's easy to imagine a perfect solution, or to code a simple one. But to code a 
high-quality solution, that really _does_ solve all the practical problems involved - that seemed like an interesting 
challenge. At the very least, I'd learn something new, outside my comfort zone. So here we are!

# Things I learned

TODO
- "X is simple" ... only if you ignore Y and Z. Which sometimes you can! Sometimes not.
- Zero-delay iteration and visualization is super helpful for bugfixing. Maybe you don't even need step-by-step debugging. Real-time visualization, turn-based debugging.
swipe + undo bug

If you wanted a brief summary, there you go. But I think one can do better than generic "best practice" type advice, so
below you will find an overview of the nitty-gritty details of what I did and why. Ordered according to the commit
history, so you can follow along step by step.

# Walkthrough

TODO: parcel for instant refresh?

## Initial commit

Right off the bat, something unusual: the root commit is an empty one. You need an extra flag to allow this behaviour,
just this one time. The reason you'd want to do this is simple: the root commit is a bit special in git, and cannot be 
changed. And if you want to keep a clean commit history from the very start, you might want to amend it once or twice
with an interactive rebase (like I did!). Having an empty commit at the root, and non-special commits for any meaningful
content afterwards lets you do exactly that.

## Direct state manipulation

For the very first version of the game, we have almost everything dumped into [main.ts](src/main.ts), with a few more 
independent pieces split off into their own files. This is my preferred approach in general: it's hard to choose the
correct place to cut things apart, when you don't yet know the logical boundaries between units - or worse, they're
still changing. And that's not an uncommon scenario when you're building out a new feature and exploring possibilities.

Even with the slightly spaghetti-ish layout, we have the seeds of a simple architecture:
- Event handlers process interactions and produce game _inputs_. 
- This is then handed off to the _game logic_, to figure out what the next state looks like.
- Based on this, we update the _scene_, a bunch of data describing what you see on-screen at any given moment. 
- Which is then read by the _renderer_, to draw the lines and rectangles and text where they need to be.

With a concrete example, a single click would flow through these systems like this:
- You clicked at coordinates (153, 130), which means you hit the middle card.
- The middle card is added to your selected path, which costs you 2 energy.
- The `highlighted` flag is set for the middle card, and your displayed energy is set to the reduced one.
- The middle card will be rendered with a different border color, and the updated energy displayed.

Separating the scene data from the logical game state might be a bit strange, at least at this point. Right now we more
or less just copy from one to the other, so why bother? [^1]

state vs scene separation: different granuliarity,discrete vs cont. no animations is the only reason we could get away with this -> direct state manipulation. this is what many apps do. 
game.ts... check next section to see why it is the way it is.

## Commit and undo

game.ts: immutability: no need for "reverse" logic. complex rules, have to be rock solid. implemented via clone + mutate, since that's good enough, but has a friendly API.
Trivial with immutable structures

## Basic animations

basic anim system
animUpdater factory: component pattern
updateScene generates animations
now based on a diff: see next chapter for better version

## Game loop events

state diff: can be enough, might lose details. 
Tagged union type, ignore events you don't care about
Still just an array, filled wiht a bunch of push calls 

## Turbo mode

there's an on/off flag, which can itself be used to have animations complete instantly, or not be scheduled at all 
the generally applicable version is just a multiplier on the elapsed time
_total_ elapsed time here, not _per-frame_. so changing speed while an animation is playing is wrong
gets fixed in a much later commit [Track elapsed time per-anim], is a todo until then.
the fix ends up being quite simple, but wanted to progress elsewhere

## Odds and ends

various cleanup and minor features follow, not much to note
undo multiple steps at once
render code extracted to its own file. shared global scene _feels_ wrong, but I don't quite know why. it is (mostly) fine in practice, though. one module only writes, other only reads. 
synchronization is not obvious here, but JS is run-to-completion anyway 
parallel animation: another combinator, this time to run multiple anims simultaneously
swipe input: check hit cell every move, if changed and unpicked, select it

## End turn logic

the name might suggest this is about the logic - in fact that's currently a NOP. in the full featured game, you have
abilities triggering on end of turn, the selected cards discarding, etc.
BUT even so, we have a problem. the animations that need to happen here are completely different from the preview ones
same for steps undone. so right now we only handle the advance case properly, rest have a TODO

## Basic cancellable animation

thought too much cleanup going on previously, because I had no idea how to start on the next feature? you'd be correct!
as this first pass at it will demonstrate clearly. probably the biggest mistake in the repo - that's why I'm leaving it there
so, one of our original goals was to not have to wait for animations ever. currently once something's scheduled, it'll
eventually play for sure. so if you select a long path, then quickly undo all of it, you'll have to wait for ALL anims to
play until it reaches the end, then revert backwards one by one. ideally, what you'd want for undos is stop as soon as you can,
after the anims for whatever step you're currently at have finished playing.

and that was the idea here: we track what step we're currentlyAnimating, and if you undo a step later than that, it
will be unscheduled, and can be replaced by what you want instead

issues: anim code polluted with scheduling concerns, when and what anims should play. does not handle undoing played steps, 
you'll need to know what anim happened to know its undo version. right now that's just popped off the stack, into oblivion

## Performance non-pessimization

You might object to the title above, since non-pessimization isn't a real word. But I'm glad [someone](perf talk by cmuratori) came up with it,
because it's a useful idea. Whereas "optimization" would mean digging super deep, finding the best solution for a
specific problem, making the most of your specific hardware, non-pessimization is a far simpler thing: don't give the
CPU unnecessary work. Eliminating waste can get you pretty damn far all by itself, you only need to notice where wastage
is happening, and get rid of it. We have some classic examples here:

- The hit boxes for the board's cells were calculated inside the mousemove handler, which is triggered super frequently. However, the cells' boundaries won't change, making all but the first time wasted effort. So we simply figure those out on startup, and that's it. The general idea is that if you can calculate something less frequently, do so.
- A slightly more complicated case is caching the on-screen position of the canvas, which can change if the browser is scrolled or resized - but only then. So we cache the latest position we got, and reuse that until it's invalidated through scrolling or resizing. This approach works in general for any expensive operation.
- In a later commit, [explicit impl of state cloning], the cloneDeep library function is replaced with a handwritten equivalent. That wasn't picked randomly, once this code was running in a tight loop, the profiler immediately showed that this is where 95% of the time was being spent. The explicitly implemented version is a 100x faster, simply by virtue of not doing any needless work. The library function has to work with all kinds of data, but in our case, we know the exact type ahead of time.

## Main loop

in "extract input handling functions", but this is the actually interesting part.
previously, we had a very event-driven system, with no synchronization between the subsystems. they each just do their
own thing whenever they want, whether it's sensible or not. When a cell is clicked, we re-render the screen - usually unnecessarily, since when an animation is running, we have to do that on the end of frame anyway. Having a central point in the main loop makes it so we can tie everything together in an obvious place. This is what sorts out the messy animation code in this commit[move anim to main loop]: once the current animations have finished playing, and we had some user input in the meantime, we need to figure out what animation to play next, and start it.

That figuring out part is pretty hairy itself, even with the code comments, so let's go to a separate paragraph for it.

## Animation logic
 
[1]: Actually, in this version, even the renderer directly references the game state! Told you it was spaghetti.