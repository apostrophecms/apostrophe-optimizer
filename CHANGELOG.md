## Changelog

### 2.0.2

* findWithProjection must be handled correctly
* Locale queries are more efficient now in workflow, detect those properly
* Optimizer support for truly locale-specific queries, vs. just "current locale or locale-less docs"
* No redundant values in `$in`

### 2.0.1

Fixed a bug affecting subpages. 404s were sent for subpages on the second access in certain circumstances.

### 2.0.0

Initial release.
