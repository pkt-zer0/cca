
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
- __Animations blocking input__: If you tap a card on the board, it'll play a short animation and then become selected.
  If you tap an adjacent card, it'll be added as the next step of the path after a short animation. However, if you tap
  the second card _while_ the first one is animating, it'll react as if it was non-adjacent, since the first card isn't
  considered selected yet. Somewhat amusingly, tapping a non-adjacent card de-selects the previous step - so if you're
  too fast with the inputs, you can end up watching your first card animate back and forth while you're trying to move
  on to the next step.
- __Slow animations__: There are unique and clear animations for every interaction you have with the cards, which helps
  understand exactly what's going on. Some are extra weighty and slow to communicate your impending doom! But after a
  billion matches, you'll know exactly what's going on, and will just want to get on with it.
- __No swipe input__: For some irrational reason, I find swipe inputs to be great fun on a touchscreen. They're not
  supported here, you need to tippity-tap your way through each step of the path.

Fixing these issues did not seem too hard, but instead of complaining about it on the internets, I thought I'd take a
crack at these problems myself. It's easy to imagine a perfect solution, or to code a simple one. But to code a
high-quality solution, that really _does_ solve all the practical problems involved - that seemed like an interesting
challenge. At the very least, I'd learn something new, outside my comfort zone. So here we are!

# Things I learned

Let's start with the somewhat unexpected realizations, then.

- Simplicity depends on the context. Implementing X might be simple... but only if you ignore Y and Z. Whether that's
safe to do so depends entirely on your specific requirements. Most of the rework in this codebase stems from features
getting more nuanced over time: the simplest initial solution, while convenient, could not support what actually needed
to happen in later iterations.

- Zero-delay feedback and visualization is super helpful for bugfixing. Edge cases and concurrency issues can be hard to
spot with the code at rest, but when interacting with it at runtime, they will be quite noticeable. If you then also
have the ability to tweak things and see what happens, you can experiment with fixes or even alternative solutions quite
easily.

If you wanted a brief summary, there you go. But I think one can do better than generic "best practice" type advice, so
below you will find an overview of the nitty-gritty details of what I did and why. Ordered according to the commit
history (with some exceptions made to group things more logically), so you can follow along step by step.

# Walkthrough

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

The two "worlds" operate using different granularity: game logic is discrete in time and space, the UI is continuous in
both. As far as the game rules are concerned, a card being selected is just a true/false flag, which only changes on
user input. On the UI, a card being selected might mean that it gently eases its coordinates over 500ms to 15 pixels
above its regular position. In other words, the _only_ reason a straight-up copy works here is that we have no
animations yet. Many applications do just fine without them - but games are not in that category.

But before we get to that, let's take a quick look at the [game logic code](src/game.ts), and why it is the way it is.

## Commit and undo

The main point of interest here is `next()`, which is a pure function used to advance the game state based on player
input. The motivation for purity is the preview system: any move you make, you need to be able to undo as well.

If the original move is a change that takes you from state A to B, you'll need a reverse change that takes you from B to
A, so you end up where you started. However, if you make a mistake in the reverse logic, you can end up in state C
instead: in a no man's land, outside the boundaries set by the normal game rules, unreachable by regular "forwards"
moves.

An alternative solution that's guaranteed to be correct, no matter how complex the game logic is, relies on a state
save/load functionality. To undo a move that went from A to B, you simply need to load state A, which you have saved
previously. That way, a reverse change will only ever take you back to a state that you have seen previously: going out
of bounds is _impossible, by design_.

The save/load part is made trivial with immutable data structures: in this case, all you need to save and restore is an
object reference. So that's all our undo system is doing: pushing state references onto a stack when advancing forwards,
and popping the last one off when going backwards.

I also cheat on the purity / immutability parts a bit: inside `next()`, we copy the starting state, and everything is
free to modify it, right up until the function returns. From the outside, it still looks like a pure function dealing
with immutable data, but its internal implementation is a lot more natural, and performance isn't that bad, either. [^2]

In addition to a `GameState`, the `next()` function can also return an `Error`. In many cases I find this solution
preferable to thrown exceptions, since this way the caller is forced to handle them by the type checker. [^3] On the
other hand, you could raise exceptions deep down in a call stack, and have them automatically propagate upwards - which
is only really useful if you intend to _ignore_ errors, rather than handle them. Which is definitely not the goal here.

## Basic animations

In the next commit, we finally get to our first animations: card selection! Instead of an instantaneous jump between the
selected and unselected appearance, we'll gently blend between the two. The scene data structure now also reflects this,
with the highlight state now being a number between 0 and 1, not just a mere boolean.

This also means that `updateScene()` will now have to be a bit more indirect, and instead of directly updating the scene,
it's job will instead be to figure out which _animations_ need to be triggered (which then do the updating). To do that,
we push some items to a global `animations` array, which will then be picked up and executed sequentially by
`runAnimations()`, invoked each frame, just before re-rendering.

On the technical side, an animation here is just a `requestAnimationFrame` callback (with the minor addition of the
return value indicating when it has finished). Its single input parameter is the current timestamp, which can be used to
figure out how much time has passed since the start of the anim. And since it's a lot more convenient to deal with
elapsed time, the `animationUpdater` wrapper function lets us do exactly that, without needing to include the same
boilerplate code everywhere.

## Game loop events

Right now, figuring out what animations need to be played are done based on the game state alone - specifically,
comparing the current and next ones, to figure out the difference. Which works well enough for boolean states like the
path selection, and is reversible for the undo animations. However, sometimes it's not just the end result that matters,
but also _how_ you got there. If you lose 5 health in total, you also want to be able to tell which enemies or abilities
that damage came from. Or maybe a small goblin hitting you has an entirely different animation than a huge ogre smashing
you into bits.

This is handled by extending the game update logic to also include a list of events alongside the next state. These are
generated whenever something interesting happens, even within a single step! And then later on these can be used to
trigger the specific animations needed. (I was slightly lazy, so the undo case is still based on a state diff... don't
worry, that'll also be fixed eventually)

The events themselves use a tagged union type, which is the type-theoretical jargony term for having a field that lets
you know what other fields an object has. This way you can include whatever data is necessary for any event, and filter
them by tag to find the ones you care about, ignoring the rest.

## Turbo mode

This is the solution for one of the initial goals, letting you skip or speed up animations. For the first pass, this
just pretends time runs at four times its regular speed - more specifically, it's a multiplier for the elapsed time
in `animationUpdater`. Since that tracks the _total_ time elapsed, not _per-frame_, if you turn on turbo mode in the
middle of an animation, it will lurch forward with an awkward jump. This is fixed in a [much later commit][turbo_fix],
and is just a TODO until then. Turns out, the fix ends up being quite simple, but I wanted to progress in other areas,
instead of getting stuck on a minor bug like this. Keeping forward momentum _somewhere_ helps keep motivation high,
I've found.

## Odds and ends

That's exactly the theme for the next couple of commits, various unrelated quick wins and fun features. These include,
but are not limited to:

- Letting you undo multiple steps at once. If you click an earlier step in the path, it'll roll you back all the way
  there. Exact same logic as before, just triggered multiple times.

- The rendering code is split to its own file. Having a shared global variable for the scene _feels_ wrong, but I don't
  quite know why. It turns out to be (mostly) fine in practice, though. The responsibilities for the two modules accessing
  it are separated well enough: one only writes, the other only reads from it. [^4]

- Parallel animation support is added. This is done with another wrapper function, which you can pass anims into, to
  have them run simultaneously, the whole batch only being considered finished once all individual ones are.

- Swipe input! Yet another of the initial goals gets ticked off, but this also happens to be a fun one. The code is
  _almost_ as simple as just selecting whatever card you move over while having the mouse button down, but there are a
  couple of wrinkles to it. The hit boxes are slightly smaller, so you can comfortably move diagonally between cards as
  well. Undo is limited to the last step, so accidentally brushing an early card doesn't rollback all your choices. These
  are not immediately obvious requirements - until you actually try to use this input method. One more reason short
  iteration times are great.

## End turn logic

The name is slightly misleading, since there is actually no game logic happening here in this super-minimized example,
only the path selection is cleared. In the proper game, you have effects and abilities triggering at end of turn, your
selected path gets discarded and redrawn, that sort of thing.

Even without that, we have a problem that needs solving: the animation for a _committed_ action can be quite different
from its preview. Defeating an enemy will merely bring its health to zero during the preview, but after the commit,
you'll see its card being burned to cinders instead. So we need the same possibility here, to show some additional
animations, determined via a different logic, once you end your turn. And indeed we have that... namely, the
_possibility_. The _implementation_ is left as an exercise for the reader. (I am sometimes amazed by my own laziness.)

## Basic cancellable animation

After a bit of code refactoring, I thought I finally had a good enough idea to tackle a useful feature as well. I was
wrong. So this commit is left here not as an example, but as a warning. A reminder that sometimes you produce garbage,
and that's all right, as long as you later remember to recycle it into something better.

But let's rewind a bit: the problem in question here is that animations are scheduled in a fire and forget manner.
Once you trigger them, they _will_ eventually play, even if you completely change your path selection for the turn in
the meantime. If you select a path with 9 cards, then immediately revert to 2, you will have to watch all nine
of them get activated, then get reverted one-by-one. A better solution would be to skip the revert animations entirely,
except for the cases where the activation ones have already started playing.

As you might guess, that's not what is implemented here, but a half-working version of half the functionality,
broken in various amusing ways. It was simple to code - but it's also wrong. You'll see a correct solution 
[later][anim_fixed].

## Performance non-pessimization

You might object to the title above, since non-pessimization isn't a real word. But I'm glad [someone][perf_talk] came 
up with it, because it's a useful idea. Whereas "optimization" would mean digging super deep, finding the best solution
for a specific problem, making the most of your specific hardware, 4 non-pessimization is a far simpler thing: don't
give the CPU unnecessary work. Eliminating waste can get you pretty damn far all by itself, you only need to notice
where wastage is happening, and get rid of it. We have some classic examples here:

- The hit boxes for the board's cells were calculated inside the mousemove handler, which is triggered super frequently.
  However, the cells' boundaries won't change, making all but the first time wasted effort. So we simply figure those out
  on startup, and that's it. The general idea is that if you can calculate something less frequently, do so.

- A slightly more complicated case is caching the on-screen position of the canvas, which can change if the browser is
  scrolled or resized - but only then. So we cache the latest position we got, and reuse that until it's invalidated
  through scrolling or resizing. This approach works in general for any expensive operation.

- In a later [commit][state_cloning], the cloneDeep library function is replaced with a handwritten equivalent. That 
  wasn't picked randomly, once this code was running in a tight loop, the profiler immediately showed that 95% of the
  time was being spent here. The explicitly implemented version is a 100x faster, simply by virtue of not doing any
  needless work. The library function has to work with all kinds of arbitrary structures, but in our case, we know the
  exact type ahead of time.

Non-pessimized code also saves _you_ time, not just the CPU. You don't need to figure out how to send off computations
onto a background worker thread and receive the eventual results, when a blocking, synchronous call is plenty fast.
Simpler is faster, faster is simpler.

## Main loop

This is the part where I rediscover the age-old concept of a "main update loop". [^5] The [commit][main_loop] is called
"extract input handling functions", but the interesting part is actually the `update()` function introduced, and later
expanded, in `main.ts`.

So far the various parts of the code have been doing whatever they want, whenever they want. Event handlers fire,
updating some shared or even global state, and then hope that everything else can deal with that fact correctly, at the
correct time. This kind of spaghetti mess gets pretty hard to understand eventually, leading to unnecessary work or
bugs. For example, when a cell was clicked, we re-rendered the screen - entirely unnecessarily, since this starts an
animation which will do so at the end of the frame _anyway_.

Having a central point in the main loop makes it so we can tie everything together in an obvious place. This is what
makes the more sophisticated animation logic in [this commit][anim_fixed] feasible: by tracking what the player has
selected (inputs!) and what changes we've shown (anims!), we can calculate the difference to figure out what to play
next (scheduling!).

The path difference calculation aspect is a bit tricky itself, but that's what [code comments](src/main.ts#162) are for.

## Hints

The next interesting change is a [path suggestion][path_hints] feature. There would be two main practical uses for such
a thing: help new players make better moves, and make unwinnable turns immediately obvious [^6]. But mainly I wanted to
mess around with some basic AI for fun, so here it is.

The path suggestion algorithm is little more than a brute force enumeration of all possibilities: the next step is 
restricted to neighboring cells, and paths where you're already dead are abandoned immediately. Otherwise, we just pick
the best option amongst the possibilities, according to some definition of "best". Choosing this scoring function itself
is an interesting problem (a genetic algorithm could perhaps be used to select reasonable weightings for the various 
parameters), but for now I've just picked something more or less arbitrary.

# Final thoughts

If you made it this far, congratulations! That's all I have to say about this project... for the time being. There are 
always things that could be improved or added, maybe some of those will end up being educational as well.

In any case, feedback is welcome, both on the code and the documentation.

[^1]: Actually, in this version, even the renderer directly references the game state! Told you it was spaghetti.
[^2]: ...but it's still not good enough for some use cases, as you will see later.
[^3]: And the syntax is a bit more reasonable than wrapping individual calls in try-catch blocks.
[^4]: Synchronization would be something to think about here, if JS wasn't executed in a run-to-completion fashion.
[^5]: Like I said, I'm not a gamedev guy ;)
[^6]: The preview system only shows if you'd lose given the path you've chosen for the turn. This would show if you'd 
      lose regardless of what you choose.

[anim_fixed]: ../../commit/db8426d1d55641280c54aded6e256c3b723dc564
[state_cloning]: ../../commit/c4f8bc324c80b0183da4d85ad9ccbd70d9a8150f
[turbo_fix]: ../../commit/7ed48bf3c588d163b8c867aea2899175bf2671ce
[main_loop]: ../../commit/6c92dec39dcdb7341f5ac0c1e0d627e4ccc752c4
[path_hints]: ../../commit/5ba11769b5e85c218a5b136aa4346cc0c8642e9d

[perf_talk]: https://www.youtube.com/watch?v=pgoetgxecw8