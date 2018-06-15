var assert = require('assert');
var request = require('request-promise');
var Promise = require('bluebird');

describe('apostrophe-optimizer', function() {

  var apos;
  var products = [];

  this.timeout(20000);

  after(function() {
    apos.db.dropDatabase();
  });

  /// ///
  // EXISTENCE
  /// ///

  it('should be a property of the apos object', function(done) {
    apos = require('apostrophe')({
      testModule: true,

      modules: {
        'apostrophe-pages': {
          park: [
            {
              type: 'testPage',
              title: 'Test Page',
              slug: '/test-page',
              published: true
            }
          ],
          types: [
            {
              name: 'home',
              label: 'Home'
            },
            {
              name: 'testPage',
              label: 'Test Page'
            }
          ]
        },
        'products': {
          extend: 'apostrophe-pieces',
          alias: 'products',
          name: 'product'
        },
        'products-widgets': {
          extend: 'apostrophe-pieces-widgets'
        },
        'apostrophe-optimizer': {
          stats: true,
          alias: 'optimizer',
          tagOptimized: true
        }
      },
      afterInit: function(callback) {
        assert(apos.modules['apostrophe-optimizer']);
        // Because we specifically aliased it above for the test site
        assert(apos.optimizer);
        return callback(null);
      },
      afterListen: function(err) {
        assert(!err);
        done();
      }
    });
  });

  it('should not break mongo queries with callbacks', function(done) {
    return apos.docs.db.find().toArray(function(err, docs) {
      assert(!err);
      assert(docs.length > 0);
      done();
    });
  });

  it('should not break mongo queries with promises', function() {
    return apos.docs.db.find().toArray().then(function(docs) {
      assert(docs.length > 0);
    });
  });

  /// ///
  // SETUP
  /// ///

  it('should be able to fetch the home page the first time', function() {
    return request('http://localhost:3000').then(function(body) {
      assert(body);
      body = JSON.parse(body);
      assert(body[0]);
      assert(body[0].slug === '/');
      // No optimization on initial request
      assert(!apos.optimizer.stats.optimized);
    });
  });

  it('should be able to fetch the home page a second time, with optimization', function() {
    return request('http://localhost:3000').then(function(body) {
      assert(body);
      assert(apos.optimizer.stats.optimized > 0);
      body = JSON.parse(body);
      assert(body[0]);
      assert(body[0].slug === '/');
      assert(body[0].__optimized);
      assert(body[1]);
      assert(body[1].slug === 'global');
      assert(body[1].__optimized);
    });
  });

  it('should be able to fetch a subpage the first time', function() {
    return request('http://localhost:3000/test-page').then(function(body) {
      assert(body);
      body = JSON.parse(body);
      assert(body[0]);
      assert(body[0].slug === '/test-page');
      assert(!body[0].__optimized);
      assert(body[1]);
      assert(body[1].slug === 'global');
      assert(!body[1].__optimized);
    });
  });

  it('should be able to fetch a subpage a second time, with optimization', function() {
    return request('http://localhost:3000/test-page').then(function(body) {
      assert(body);
      assert(apos.optimizer.stats.optimized > 0);
      body = JSON.parse(body);
      assert(body[0]);
      assert(body[0].slug === '/test-page');
      assert(body[0].__optimized);
      assert(body[1]);
      assert(body[1].slug === 'global');
      assert(body[1].__optimized);
    });
  });

  it('should be able to insert products', function() {
    var i;
    for (i = 0; (i < 10); i++) {
      products[i] = apos.products.newInstance();
      products[i].title = 'Camembert #' + i;
      products[i].published = true;
    }
    return Promise.map(products, function(product) {
      return apos.products.insert(apos.tasks.getReq(), product);
    });
  });

  it('should be able to update the home page to include a products widget', function(done) {
    apos.pages.find(apos.tasks.getReq(), { slug: '/' }).toObject().then(function(home) {
      home.body = {
        type: 'area',
        items: [
          {
            _id: 'testwidget',
            type: 'products',
            by: 'id',
            pieceIds: [ products[5]._id, products[8]._id ]
          }
        ]
      };
      apos.pages.update(apos.tasks.getReq(), home, function(err) {
        assert(!err);
        done();
      });
    });
  });

  it('should not optimize widget joins on first pass', function() {
    return request('http://localhost:3000').then(function(body) {
      assert(body);
      body = JSON.parse(body);
      assert(body[0]);
      assert(body[0].slug === '/');
      assert(body[0].body.items.length === 1);
      var widget = body[0].body.items[0];
      assert(widget.type === 'products');
      assert(widget._pieces[0]);
      assert(widget._pieces[0].title === 'Camembert #5');
      assert(!widget._pieces[0]._optimized);
      assert(widget._pieces[1]);
      assert(widget._pieces[1].title === 'Camembert #8');
      assert(!widget._pieces[1]._optimized);
      assert(!widget._pieces[2]);
    });
  });

  it('should optimize widget joins on second pass', function() {
    return request('http://localhost:3000').then(function(body) {
      assert(body);
      body = JSON.parse(body);
      assert(body[0]);
      assert(body[0].__optimized);
      assert(body[0].slug === '/');
      assert(body[0].body.items.length === 1);
      var widget = body[0].body.items[0];
      assert(widget.type === 'products');
      assert(widget._pieces[0]);
      assert(widget._pieces[0].title === 'Camembert #5');
      assert(widget._pieces[0].__optimized);
      assert(widget._pieces[1]);
      assert(widget._pieces[1].title === 'Camembert #8');
      assert(widget._pieces[1].__optimized);
      assert(!widget._pieces[2]);
      console.log(apos.optimizer.stats);
    });
  });

});
