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

```
# Should only need to do this once, it's automatic on future saves
node app apostrophe-optimizer:reoptimize
```

This module accelerates Apostrophe by reducing the number of MongoDB queries.

The module works by remembering the IDs of documents that are fetched via joins and prefetching those documents, rather than carrying out several waves of MongoDB queries. This is possible for about 30-50% of queries on a typical site. The rest pass through MongoDB as usual.

To ensure consistent results, the prefetched documents are passed through the `sift` library, which
can execute the same query syntax as MongoDB. When this cannot be done due to limitations of `sift``,
MongoDB is queried as a fallback.

## When to use it

When MongoDB is on a separate server, you'll find that the latency makes avoiding queries a big win. When it takes time to communicate with MongoDB, there is a big advantage in using this module.

## When not to use it

When MongoDB is on the same server, we generally haven't seen a performance improvement. That's because we're asking JavaScript to do the filtering work of MongoDB. Not surprisingly, MongoDB is faster at that... unless it takes time to communicate with MongoDB in the first place.

## Impacts on your custom code

If your code writes to Apostrophe docs using Apostrophe's APIs, then the prefetched data for those docs is automatically cleared. However, if you update docs directly with MongoDB, this does not happen. So you could get stale data if you query Apostrophe for the object later in that same request (other requests would never be impacted by this issue).

TODO: provide an API to clear the prefetched data for a single doc id or all docs.
