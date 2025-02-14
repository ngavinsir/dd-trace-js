'use strict'

const path = require('path')

const Analyzer = require('./vulnerability-analyzer')
const { WEAK_HASH } = require('../vulnerabilities')

const INSECURE_HASH_ALGORITHMS = new Set([
  'md4', 'md4WithRSAEncryption', 'RSA-MD4',
  'RSA-MD5', 'md5', 'md5-sha1', 'ssl3-md5', 'md5WithRSAEncryption',
  'RSA-SHA1', 'RSA-SHA1-2', 'sha1', 'md5-sha1', 'sha1WithRSAEncryption', 'ssl3-sha1'
].map(algorithm => algorithm.toLowerCase()))

const EXCLUDED_LOCATIONS = [
  path.join('node_modules', 'etag', 'index.js'),
  path.join('node_modules', 'redlock', 'dist', 'cjs'),
  path.join('node_modules', 'ws', 'lib', 'websocket-server.js'),
  path.join('node_modules', 'mysql2', 'lib', 'auth_41.js'),
  path.join('node_modules', '@mikro-orm', 'core', 'utils', 'Utils.js')
]

const EXCLUDED_PATHS_FROM_STACK = [
  path.join('node_modules', 'object-hash', path.sep)
]
class WeakHashAnalyzer extends Analyzer {
  constructor () {
    super(WEAK_HASH)
    this.addSub('datadog:crypto:hashing:start', ({ algorithm }) => this.analyze(algorithm))
  }

  _isVulnerable (algorithm) {
    if (typeof algorithm === 'string') {
      return INSECURE_HASH_ALGORITHMS.has(algorithm.toLowerCase())
    }
    return false
  }

  _isExcluded (location) {
    return EXCLUDED_LOCATIONS.some(excludedLocation => {
      return location.path.includes(excludedLocation)
    })
  }

  _getExcludedPaths () {
    return EXCLUDED_PATHS_FROM_STACK
  }
}

module.exports = new WeakHashAnalyzer()
