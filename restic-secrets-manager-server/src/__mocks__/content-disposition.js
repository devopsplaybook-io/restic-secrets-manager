// content-disposition 3.x is ESM-only, which Jest's CommonJS runtime cannot
// require. Only `create` is used (by the download feature, not tested here).
module.exports.create = () => () => "";
