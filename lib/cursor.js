var _ = require('lodash');
var Promise = require('bluebird');
var sift = require('sift');
var async = require('async');

module.exports = {

  construct: function(self, options) {

    var optimizer = self.apos.modules['apostrophe-optimizer'];
    if (optimizer.options.stats) {
      optimizer.statsSoon();
    }

    var superLowLevelMongoCursor = self.lowLevelMongoCursor;

    self.lowLevelMongoCursor = function(req, criteria, projection, options) {
      var docs;
      if (!self.optimizeCompatible(req, criteria, projection, options)) {
        if (optimizer.options.debug) {
          optimizer.debug('cannot handle query due to constraints beyond optimized ids for this req, kicking it over to MongoDB: ', require('util').inspect(criteria, { depth: 20 }), JSON.stringify(_.keys(req.optimizeDocs), null, '  '));
        }
        return self.optimizeAggregateIfAppropriate(req, criteria, projection, options);
      }
      try {
        docs = self.optimizeFilterDocs(req, criteria, projection, options);
      } catch (e) {
        if (optimizer.options.debug) {
          optimizer.debug('cannot handle query due to sift limitation, kicking it over to MongoDB: ', e, require('util').inspect(criteria, { depth: 20 }));
        }
        return self.optimizeAggregateIfAppropriate(req, criteria, projection, options);
      }
      // return a fake MongoDB cursor. TODO: a more complete emulation, but this is what
      // Apostrophe currently requires
      if (optimizer.options.stats) {
        optimizer.stats.optimized++;
      }
      return {
        toObject: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          return body(callback);
          function body(callback) {
            return callback(null, docs[0]);
          }
        },
        toArray: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          return body(callback);
          function body(callback) {
            return callback(null, docs);
          }
        },
        count: function(callback) {
          if (!callback) {
            console.log('no callback');
            return Promise.promisify(body)();
          }
          console.log('has callback');
          return body(callback);
          function body(callback) {
            return callback(null, docs.length);
          }
        }
      };
    };

    // Returns a cursor that uses mongodb aggregation under the hood and prefetches
    // docs if possible, otherwise a vanilla mongo cursor

    self.optimizeAggregateIfAppropriate = function(req, criteria, projection, options) {
      var everything = (!projection) || _.isEmpty(projection);
      req.optimizeAggregateCount = req.optimizeAggregateCount || 0;
      var interesting = everything; //  && (req.optimizeAggregateCount < 6);
      if (interesting) {
        if (optimizer.options.stats) {
          optimizer.stats.aggregating++;
        }
        req.optimizeAggregateCount++;
        return self.optimizeAggregatingCursor(req, criteria, projection, options);
      } else {
        if (optimizer.options.stats) {
          optimizer.stats.direct++;
        }
        return superLowLevelMongoCursor(req, criteria, projection, options);
      }
    };

    // Carry out the query with MongoDB. However, do it with MongoDB aggregation so
    // we can efficiently fetch related docs in the same query via `$lookup`

    self.optimizeAggregatingCursor = function(req, criteria, projection, options) {
      var cursor = {
        toObject: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          return body(callback);
          function body(callback) {
            return cursor.toArray(function(err, docs) {
              if (err) {
                return callback(err);
              } else {
                return callback(null, docs[0]);
              }
            });
          }
        },
        toArray: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          return body(callback);
          function body(callback) {
            var stages = [
              {
                $match: criteria || {}
              },
              {
                $unwind: '$optimizeIds'
              },
              {
                $lookup: {
                  from: 'aposDocs',
                  localField: 'optimizeIds',
                  foreignField: '_id',
                  as: 'optimizeDocs'
                }
              }              
            ];
            if (options.sort) {
              stages.push({ $sort: options.sort });
            }
            if (options.skip) {
              stages.push({ $skip: options.skip });
            }
            if (options.limit) {
              stages.push({ $limit: options.limit });
            }
            return self.apos.docs.db.aggregate(stages).toArray(function(err, docs) {
              if (err) {
                return callback(err);
              }
              // docs come back from aggregation in a funny format because of $unwind.
              // There is a copy of the main doc for every joined doc
              req.optimizeDocs = req.optimizeDocs || {};
              var result = [];
              var seen = {};
              _.each(docs, function(doc) {
                if (doc.optimizeDocs && doc.optimizeDocs[0]) {
                  req.optimizeDocs[doc.optimizeDocs[0]._id] = doc.optimizeDocs[0];
                }
                if (!seen[doc._id]) {
                  result.push(doc);
                  seen[doc._id] = true;
                }
              });
              docs = result;
              if (!_.isEmpty(projection)) {
                docs = self.optimizeProjection(projection);
              }
              return callback(null, docs);
            });
          }
        },
        count: function(callback) {
          if (!callback) {
            return Promise.promisify(body)();
          }
          console.log('invoking count');
          return body(callback);
          function body(callback) {
            return superLowLevelMongoCursor(req, criteria, projection, options).count(callback);
          }
        }
      };
      return cursor;
    };


    // Reject anything with _id's not found in the keys of req.optimizeDocs.
    // Also reject projections that use metafields we can't replicate
    // (we can't do text search without real mongo). We do not have to worry
    // about unsupported mongo operators in `sift` because sift will throw
    // an exception, which we catch in `optimizeFilterDocs`.

    self.optimizeCompatible = function(req, criteria, projection, options) {
      var ids = _.keys(req.optimizeDocs || {});
      var other;
      return criteriaSafe(criteria) && projectionSafe();
      function criteriaSafe(criteria) {
        if (criteria.$and) {
          other = _.omit(criteria, '$and');
          if (!_.isEmpty(other)) {
            return criteriaSafe({ $and: [ other ].concat(criteria.$and) });
          }
          // $and: at least one subclause must be safe, because it constrains all the others
          return _.some(criteria.$and, criteriaSafe);
        } else if (criteria.$or) {
          other = _.omit(criteria, '$or');
          if (!_.isEmpty(other)) {
            return criteriaSafe({ $and: [ other ].concat([ { $or: criteria.$or } ]) });
          }
          // $or: every subclause must be safe (here written "there must be no subclause
          // which is not safe")
          return !_.some(criteria.$or, function(criteria) {
            return !criteriaSafe(criteria);
          });
        } else {
          return simpleCriteriaSafe(criteria);
        }
      }

      function projectionSafe() {
        return self.optimizeProjectionSafe(projection);
      }

      // A simple criteria object without $and or $or may be said to be safe
      // if it has an `_id` property and that property permits only ids
      // already fetched by the optimizer

      function simpleCriteriaSafe(criteria) {
        if (criteria._id) {
          if (_.includes(ids, criteria._id)) {
            return true;
          }
          if (criteria._id.$in && (!_.difference(criteria._id.$in, ids).length)) {
            return true;
          }
        }
        return false;
      }
    };

    // May throw an exception if the implementation cannot support some of
    // the criteria (sift will throw an exception on unknown operators).

    self.optimizeFilterDocs = function(req, criteria, projection, options) {
      var docs;
      docs = sift(criteria, _.values(req.optimizeDocs));
      if (_.isNumber(options.skip)) {
        docs = docs.slice(options.skip);
      }
      if (_.isNumber(options.limit)) {
        docs = docs.slice(0, options.limit);
      }
      self.optimizeSort(docs, options.sort);
      if (projection) {
        docs = self.optimizeProjection(docs, projection);
      }
      // "Why are we cloning?" Because we would otherwise return the same
      // objects from multiple queries, which might modify them differently
      // with no expectation of side effects.
      //
      // "Why with this method?" Because we already trust it to cope with
      // all types of content stored to the database in Apostrophe. 
      return self.apos.utils.clonePermanent(docs);
    };

    // Carry out projection in a MongoDB-compatible way
    // (subject to limitations detectable beforehand by
    // optimizeProjectionSafe)

    self.optimizeProjection = function(docs, projection) {
      if (_.values(projection)[0]) {
        docs = _.map(docs, function(doc) {
          return _.pick(doc, _.keys(projection));
        });
      } else {
        docs = _.map(docs, function(doc) {
          return _.omit(doc, _.keys(projection));
        });
      }
    }

    // Returns true if the projection can be safely handled by the
    // `optimizeProjection` method, otherwise you should fall back
    // to MongoDB native
    self.optimizeProjectionSafe = function(projection) {
      var result = !_.some(_.keys(projection), function(key) {
        // All projection values must be simple flags, objects imply something
        // fancy like $meta is going on
        return projection[key] && ((typeof projection[key]) === 'object');
      });
      return result;
    };

    // MongoDB-compatible sorting. See the MongoDB `sort` method.
    self.optimizeSort = function(docs, sort) {
      return docs.sort(function(a, b) {
        var keys = _.keys(sort);
        var i;
        for (i = 0; (i < keys.length); i++) {
          var av = a[keys[i]];
          var bv = b[keys[i]];
          if (sort[keys[i]] < 0) {
            if (av < bv) {
              return 1;
            } else if (av > bv) {
              return -1;
            }
          } else {
            if (av < bv) {
              return -1;
            } else if (av > bv) {
              return 1;
            }
          }
        }
        // equal according to all criteria
        return 0;
      });

    };

    self.apos.tasks.add(self.__meta.name, 'reoptimize', 'Reoptimize docs for fewer total database queries.\nShould only be needed once when transitioning to versions of Apostrophe\nthat support this feature. Safe to run again however.', function(apos, argv, callback) {

      var req = self.apos.tasks.getReq();

      // All this task currently does is re-fetch docs (so we get them with all of their joins etc.)
      // and then re-save them (so they update optimizeIds).

      return self.apos.migrations.eachDoc({}, 5, function(doc, callback) {
        return Promise.try(function() {
          return self.apos.docs.find(req).toObject(doc)
        }).then(function(doc) {
          if (!doc) {
            return;
          }
          return self.apos.docs.update(req, doc);
        }).then(function() {
          return callback(null);
        }).catch(function(err) {
          return callback(err);
        });
      }, callback);
    });

  }

};
