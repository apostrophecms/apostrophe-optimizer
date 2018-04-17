# apostrophe-optimizer

## Requirements

Up-to-date 2.x versions of apostrophe and, if you are using it, apostrophe-workflow.

## Installation

```
npm install apostrophe-optimizer
```

```
// in `app.js`
...
modules: {
  'apostrophe-optimizer': {
    // Periodically print an update of direct mongo queries vs eliminated queries
    stats: true,
    // Print verbose information about queries that could not be optimized
    // (those not limited to prefetched ids, and those with MongoDB operators
    // not supported by Swift). DEBUG SLOWS IT DOWN, do NOT leave on during speed tests
    debug: true
  }
}
```

This module accelerates Apostrophe by reducing the number of MongoDB queries.

The module works by noting the simple unique keys (`_id`, `slug`, `path`) used in queries for a given URL, then prefetching documents matching those keys before normal queries in middleware when the URL is next accessed. If a subsequent query provably depends only on the docs in that collection, it is then satisfied within Apostrophe, using the Sift library to implement MongoDB-compatible queries. Otherwise it passes through to MongoDB. Thus this is not a cache, beyond the lifetime of a single `req` at least, and does not lead to issues with stale data under normal circumstances.

For queries that cannot be handled by `sift`, MongoDB is queried directly.

## When to use it

When MongoDB is on a separate server, you'll find that the latency makes minimizing consecutive queries a big win. When it takes time to communicate with MongoDB, there is a big advantage in using this module. There is also an advantage when using additional Node.js CPU time is cheaper for you than processing additional MongoDB queries.

When network latency to MongoDB is around 10ms, a speedup between 30% and 50% has been observed. Your mileage may vary; see "gathering stats on performance," below.

## When not to use it

When MongoDB is on the same server as Node.js, the performance benefit is smaller (around 10% in our tests), but this may still be worth your while.

And, of course, your mileage may vary. So use the `stats: true` option to check performance.

## Gathering stats on performance

Set `stats` to `true`. **Do not** use `stats` and `debug` at the same time to gather information about the performance of the optimizer, as the debug calls consume quite a bit of time.

## Simulating the latency of real world cloud database hosting

Often MongoDB is on the same server in your dev environment.

To simulate latency, set the `delay` to the number of milliseconds of delay to simulate. Bear in mind this delay is added both "coming" and "going," i.e. before the query goes out and before the response is received, which is a good match for what real world latency does.

For instance:

```
// in `app.js`
...
modules: {
  'apostrophe-optimizer': {
    stats: true,
    delay: 10
  }
}
```

## Gathering stats on performance *without* the optimizer

You can set the `enable: false` flag to disable the optimization, but keep `stats: true` to see  how much time is being spent in various MongoDB queries. This makes it easier to profile your site and determine whether this module is a win for your needs.

## Impacts on your custom code

If your code modifies docs using Apostrophe's own APIs, then the prefetched docs are automatically discarded so that efforts to `find` those docs again with Apostrophe in the lifetime of the same `req` will see the updated data. However, if your code modifies docs using low-level MongoDB APIs and expects to see the changes in during that same request lifetime, or expects to see changes *within the lifetime of a single `req`* made by external code, then you will need to invoke `req.deoptimize()` before asking Apostrophe to re-fetch a doc if you expect to see changes made during the same request.

## Tested

Tested with `mocha` and `travis-ci`.