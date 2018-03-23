var _ =require('lodash');

var req = {
  optimize: {
    queries: {
      "slug": [
        "global",
        "redirect-/fr/",
        "/fr/",
        "/fr",
        "/"
      ],
      "_id": [
        "ciyvqfzsz00ud0nmwodrlb58t",
        "ciytx5hoa00lr0nmwz1vx6zz9",
        "ciyym07ko00y40mtde9e6c2ru",
        "ciytx5hoa00lr0nmwz1vx6zz9",
        "ciz007hxm027e0mtdcdf8ktqq",
        "ciytx5hoa00lr0nmwz1vx6zz9",
        "ciyvqfzsz00ud0nmwodrlb58t",
        "ciyvqfzsz00ud0nmwodrlb58t",
        "ciz007hxm027e0mtdcdf8ktqq",
        "ciz4iv2co000e0mqi0a5qnfss",
        "ciytwob8y00lo0nmwlktc5qw9",
        "ciyvqa1fj00tp0nmwn6okddf7",
        "ciyvq9kbj00tn0nmwseswuu7m",
        "ciyylz9od00y20mtdn1kcvecy",
        "ciz9xykmw01e90mkmzpo3pkpp",
        "ciyvq8u6e00tf0nmwbjahfhwb",
        "ciyvq8fdy00td0nmwdhinbmpl",
        "ciyvq95r100tl0nmw4ols5z7d",
        "cizfgbhnm00ea0lqkg38cjxbn",
        "cizfh0a6e00c50mpe03w4jmx0",
        "cizfh0w4j00fa0mqofgapi6on",
        "cizikcl0q00490mqmb98uugco",
        "cizfg718u003z0lqkhrh3azt2",
        "cizfg7qb8004j0mmcj0mkrur1",
        "cizfg8etn00740lsgogyrem0m",
        "ciytvy83400070nmwio38q2no",
        "ciyvq9kbj00tn0nmwseswuu7m",
        "cizi57tq600160mnxasommcf4",
        "cizi57tq600160mnxasommcf4",
        "cjaxodow7038v2al038hns8fc",
        "cizgyzn8g001m0lo9gwqlizqi",
        "cizgyzn8g001n0lo9ert1y58l",
        "cizgyzn8g001k0lo9c7muebpu",
        "cizgyzn38000f0lo9dplxj30g",
        "cizgyzn38000g0lo97um7a8uu",
        "cizgyzn38000h0lo90mhmjjos",
        "ciyxef8oo00n60mtd6yuud8j6",
        "cj2ha4w4404ve0mqqm176anek",
        "ciywsr207021n0nmwaoq1zm3b",
        "ciywynkeq006p0mtdg1rtyhbv",
        "ciytvy83400070nmwio38q2no",
        "ciyvq8u6e00tf0nmwbjahfhwb",
        "ciyvq8fdy00td0nmwdhinbmpl",
        "ciyvq95r100tl0nmw4ols5z7d",
        "cja3vg3c20ec62ap1hmnx2xga",
        "cja3vjcb20eer2ap1qpx4dih9",
        "cja3vnoch0egg2ap163xqte4u",
        "cj0jpz7qn001u0nnwaqn06f40",
        "cizh4wfly040e0lo9zj4nzk93",
        "cizh4x3w9040h0lo93xjgs70g",
        "cizh2h92m03200lo9z0jghejm",
        "cizh2ch8n031u0lo9lh0u2odr",
        "cizh2d7w7031x0lo9gsfdoob1",
        "cizh34skz033e0lo9m1k7n0ut",
        "cizh2yur303380lo9j5a7pofv",
        "cizh2zput033b0lo9tuz5eq0m",
        "cj2hizjmj000v0nnr9wib2zkb",
        "cj2hc8zky04vp0mqqn2fxpwzd",
        "cj2hcdw0g04w40mqqz0l5nmqj",
        "ciyxeinqn00ne0mtdy9kbj8wi",
        "ciyxeqgoq00nt0mtdyn3u5245",
        "ciyxeinqn00ne0mtdy9kbj8wi",
        "ciyxez63u00o40mtd3tzl9bki",
        "ciyxevct000nx0mtdq3468o3m",
        "cizs9oimn003k0mqy2irvqd5j",
        "ciywyp5eb007f0mtdelpv4jj3",
        "cizsacepn004l0mqys0feipqe",
        "cjcq2f72b02u12arlur7tyfld",
        "cjcpzp7co1hyb2alkkfuh8hwa",
        "cjcq0zccc01eo2arlcz3rqwe9",
        "cjcq3hy7t03k22arln5gnogph",
        "cjcq1265u01iq2arlh3com2fz",
        "cjcq143rk01l02arl4kex55w3",
        "cjcq17ndx01qt2arlm4b7g0ds",
        "ciyvvd1kz01ho0nmwfbazc7k2"
      ]
    }
  }
};

var criteria =       {
  '$and': [{
          '$and': [{
                  '$and': [{
                          '$and': [{
                                  slug: 'global'
                              },
                              {
                                  '$or': [{
                                      trash: {
                                          '$exists': 0
                                      }
                                  }, {
                                      trash: false
                                  }]
                              }
                          ]
                      },
                      {
                          published: true
                      }
                  ]
              },
              {
                  type: 'apostrophe-global'
              }
          ]
      },
      {
          '$or': [{
                  workflowLocale: 'fr'
              },
              {
                  workflowLocale: {
                      '$exists': 0
                  }
              }
          ]
      }
  ]
};

var self = {
  optimizeKeys: [ '_id', 'slug', 'path' ]
};

console.log(criteriaSafe(criteria));

function criteriaSafe(criteria) {
  var safe = false;
  _.each(self.optimizeKeys, function(key) {
    if (!req.optimize.queries[key]) {
      return false;
    }
    var val = criteria[key];
    if ((typeof val) === 'string') {
      if (_.includes(req.optimize.queries[key], val)) {
        safe = true;
        return false;
      }
    } else if (val && val.$in && Array.isArray(val.$in)) {
      if (_.difference(val.$in, req.optimize.queries[key]).length === 0) {
        safe = true;
        return false;
      }
    }  
  });
  if (criteria.$and) {
    _.each(criteria.$and, function(clause) {
      if (criteriaSafe(clause)) {
        safe = true;
        return false;
      }
    });
  }
  // We could do $or (every subclause must be safe), but
  // I don't think every subclause will be safe very often. -Tom
  return safe;
}
