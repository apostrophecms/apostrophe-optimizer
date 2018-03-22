# apostrophe-optimizer

```
npm install apostrophe-optimizer
```

```
// in `app.js`
...
modules: {
  'apostrophe-optimizer': {}
}
```

```
# Should only need to do this once, it's automatic on future saves
node app apostrophe-optimizer:reoptimize
```

This module accelerates Apostrophe by reducing the number of MongoDB queries.

The module works by remembering the IDs of documents that are fetched via joins and prefetching those documents, rather than carrying out several waves of MongoDB queries. This is possible for about 30-50% of queries on a typical site. The rest pass through MongoDB as usual.

## When to use it

When MongoDB is on a separate server, you'll find that the latency makes avoiding queries a big win. When it takes time to communicate with MongoDB, there is a big advantage in using this module.

## When not to use it

When MongoDB is on the same server, we generally haven't seen a performance improvement. That's because we're asking JavaScript to do the filtering work of MongoDB. Not surprisingly, MongoDB is faster at that... unless it takes time to communicate with MongoDB in the first place.
