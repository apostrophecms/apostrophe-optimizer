var _ = require('lodash');
var async = require('async');
var now = require('performance-now');

module.exports = {

  construct: function(self, options) {

    if (self.options.enable !== false) {
      // This method does not require a callback because it performs its work in
      // the background. It is an optimization and thus does not need to be
      // completed before other actions

      self.docAfterSave = function(req, doc, options) {
        self.updateOptimizeIds(req, doc);
      };

      // Invalidate the cache after a write.
      //
      // In spirit this should be in docAfterSave, however
      // we don't want *any* code, in any module, to try to
      // do a read after a write and get the cached content
      // that doesn't reflect the write. So we have to go first

      var superInsertBody = self.apos.docs.insertBody;
      self.apos.docs.insertBody = function(req, doc, options, callback) {
        return superInsertBody(req, doc, options, function(err) {
          if (err) {
            return callback(err);
          }
          if (req.optimizeDocs) {
            delete req.optimizeDocs[doc._id];
          }
          return callback(null);
        });
      };

      var superUpdateBody = self.apos.docs.updateBody;
      self.apos.docs.updateBody = function(req, doc, options, callback) {
        return superUpdateBody(req, doc, options, function(err) {
          if (err) {
            return callback(err);
          }
          if (req.optimizeDocs) {
            delete req.optimizeDocs[doc._id];
          }
          return callback(null);
        });
      };

      // Callback is optional. If not given, proceeds in background.

      self.updateOptimizeIds = function(req, doc, callback) {
        // Re-fetch the doc naturally with its joins. Use an admin req so
        // we get everything that could be relevant
        var manager = self.apos.docs.getManager(doc.type);
        return manager.find(self.apos.tasks.getReq(), { _id: doc._id }).trash(null).published(null).areas(true).joins(true).toObject().then(function(doc) {
          if (!doc) {
            return;
          }
          var optimizeIds = self.findIdsInDoc(doc);
          optimizeIds.sort();
          if (_.isEqual(doc.optimizeIds, optimizeIds)) {
            return;
          }
          return self.apos.docs.db.update({
            _id: doc._id
          }, {
            $set: {
              optimizeIds: optimizeIds
            }
          });
        }).then(function() {
          // Nothing more to do
          return callback && callback(null);
        }).catch(function(err) {
          if (!callback) {
            self.apos.utils.error(err);
          }
          return callback && callback(err);
        });
      };

      self.findIdsInDoc = function(doc) {
        var ids = findIds(doc);
        // widget _ids are not doc _ids
        return _.filter(_.uniq(_.difference(ids, _.keys(doc._originalWidgets))), function(id) {
          // No null ids or weird non-ids (bad legacy data)
          return id && ((typeof id) === 'string');
        });
        function findIds(object) {
          var result = [];
          if (object.type === 'attachment') {
            return result;
          }
          _.forOwn(object, function(val, key) {
            if ((key === '_id') || key.match(/Id$/)) {
              if (val) {
                result.push(val);
              }
            }
            if (key.match(/Ids$/)) {
              if (Array.isArray(val)) {
                result = result.concat(val);
              }
            }
            if (val && ((typeof val) === 'object')) {
              result = result.concat(findIds(val));
            }
          });
          return result;
        }
      };

      self.debug = function(msg) {
        if (!self.options.debug) {
          return;
        }
        msg = 'apostrophe-optimizer: ' + msg;
        self.apos.utils.debug.apply(self, [ msg ].concat([].slice.call(arguments, 1)));
      };

      self.apos.tasks.add(self.__meta.name, 'reoptimize', 'Reoptimize docs for fewer total database queries.\nShould only be needed once when transitioning to versions of Apostrophe\nthat support this feature. Safe to run again however.', function(apos, argv, callback) {

        var req = self.apos.tasks.getReq();

        // All this task currently does is re-fetch docs (so we get them with all of their joins etc.)
        // and then re-save them (so they update optimizeIds).

        return self.apos.migrations.eachDoc({}, 5, function(doc, callback) {
          return async.series({
            find: function(callback) {
              return self.apos.docs.find(req, { _id: doc._id }).toObject(function(err, _doc) {
                if (err) {
                  return callback(err);
                }
                doc = _doc;
                return callback(null);
              });
            },
            update: function(callback) {
              if (!doc) {
                return callback(null);
              }
              return self.updateOptimizeIds(req, doc, callback);
            }
          }, callback);
        }, callback);
      });

      self.apos.define('apostrophe-cursor', require('./lib/cursor.js'));
    }

    if (self.options.stats) {
      if (!self.stats) {
        self.stats = {
          direct: 0,
          aggregating: 0,
          optimized: 0,
          mongoFindMS: 0,
          mongoFindCount: 0,
          mongoAggregateMS: 0,
          mongoAggregateCount: 0,
          jsMS: 0
        };
      }
      var superFind = self.apos.docs.db.find;
      self.apos.docs.db.find = function() {
        var cursor = superFind.apply(this, arguments);
        var superToArray = cursor.toArray;
        cursor.toArray = function(callback) {
          if (callback) {
            return body(callback);
          } else {
            return Promise.promisify(body)();
          }
          function body(callback) {
            var start = now();
            return superToArray.call(cursor, function(err, docs) {
              if (err) {
                return callback(err);
              }
              self.stats.mongoFindMS += (now() - start);
              self.stats.mongoFindCount++;
              self.statsSoon();
              return callback(null, docs);
            });
          }
        };
        return cursor;
      };
      var superAggregate = self.apos.docs.db.aggregate;
      self.apos.docs.db.aggregate = function() {
        var cursor = superAggregate.apply(this, arguments);
        var superToArray = cursor.toArray;
        cursor.toArray = function(callback) {
          if (callback) {
            return body(callback);
          } else {
            return Promise.promisify(body)();
          }
          function body(callback) {
            var start = now();
            return superToArray.call(cursor, function(err, docs) {
              if (err) {
                return callback(err);
              }
              self.stats.mongoAggregateMS += (now() - start);
              self.stats.mongoAggregateCount++;
              self.statsSoon();
              return callback(null, docs);
            });
          }
        };
        return cursor;
      };

      self.statsSoon = function() {
        if (!self.statsTimeout) {
          self.statsTimeout = setTimeout(function() {
            self.apos.utils.debug(self.stats);
            self.statsTimeout = false;
          }, 2000);
        }
      };
    }

  }

};
