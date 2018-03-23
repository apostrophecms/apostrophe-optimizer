# apostrophe-optimizer

## In beta. Currently requires the `651` branch of the `apostrophe` module.

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
    // not supported by Swift)
    debug: true
  }
}
```

This module accelerates Apostrophe by reducing the number of MongoDB queries.

The module works by noting the simple unique keys (`_id`, `slug`, `path`) used in queries for a given URL, then prefetching documents matching those keys before normal queries in middleware when the URL is next accessed. If a subsequent query provably depends only on the docs in that collection, it is then satisfied within Apostrophe, using the Sift library to implement MongoDB-compatible queries. Otherwise it passes through to MongoDB. Thus this is not a cache, beyond the lifetime of a single `req` at least, and does not lead to issues with stale data under normal circumstances.

For queries that cannot be handled by `sift`, MongoDB is queried directly.

## When to use it

When MongoDB is on a separate server, you'll find that the latency makes avoiding queries a big win. When it takes time to communicate with MongoDB, there is a big advantage in using this module. There is also an advantage when using additional Node.js CPU time is cheaper for you than processing additional MongoDB queries.

## When not to use it

When MongoDB is on the same server as Node.js, the performance benefit is smaller (around 10% in our tests), but this may still be worth your while.

And, of course, your mileage may vary. So use the `stats: true` option to check performance.

## Gathering stats on performance *without* the optimizer

You can set the `enable: false` flag to disable the optimization, but keep `stats: true` to see  how much time is being spent in various MongoDB queries. This makes it easier to profile your site and determine whether this module is a win for your needs.

## Impacts on your custom code

If your code modifies docs using Apostrophe's own APIs, then the prefetched docs are automatically discarded so that efforts to `find` those docs again with Apostrophe in the lifetime of the same `req` will see the updated data. However, if your code modifies docs using low-level MongoDB APIs and expects to see the changes in during that same request lifetime, or expects to see changes *within the lifetime of a single `req`* made by external code, then you will need to set `req.optimize.docs` to `null` before asking Apostrophe to re-fetch a doc.
