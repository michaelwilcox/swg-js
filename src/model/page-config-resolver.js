/**
 * Copyright 2018 The Subscribe with Google Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Doc, resolveDoc} from './doc';
import {PageConfig} from './page-config';
import {debugLog} from '../utils/log';
import {hasNextNodeInDocumentOrder} from '../utils/dom';
import {tryParseJson} from '../utils/json';
import {user} from '../utils/error-logger';

const ALREADY_SEEN = '__SWG-SEEN__';
const CONTROL_FLAG = 'subscriptions-control';

const ALLOWED_TYPES = [
  'CreativeWork',
  'Article',
  'NewsArticle',
  'Blog',
  'Comment',
  'Course',
  'HowTo',
  'Message',
  'Review',
  'WebPage',
];

// RegExp for quickly scanning LD+JSON for allowed types
const RE_ALLOWED_TYPES = new RegExp(ALLOWED_TYPES.join('|'));

/**
 */
export class PageConfigResolver {
  /**
   * @param {!Window|!Document|!Doc} winOrDoc
   */
  constructor(winOrDoc) {
    /** @private @const {!Doc} */
    this.doc_ = resolveDoc(winOrDoc);

    /** @private {?function((!PageConfig|!Promise))} */
    this.configResolver_ = null;

    /** @private @const {!Promise<!PageConfig>} */
    this.configPromise_ = new Promise((resolve) => {
      this.configResolver_ = resolve;
    });

    /** @private @const {!MetaParser} */
    this.metaParser_ = new MetaParser(this.doc_);
    /** @private @const {!JsonLdParser} */
    this.ldParser_ = new JsonLdParser(this.doc_);
    /** @private @const {!MicrodataParser} */
    this.microdataParser_ = new MicrodataParser(this.doc_);
  }

  /**
   * @return {!Promise<!PageConfig>}
   */
  resolveConfig() {
    // Try resolve the config at different times.
    Promise.resolve().then(this.check.bind(this));
    this.doc_.whenReady().then(this.check.bind(this));
    return this.configPromise_;
  }

  /**
   * @return {?PageConfig}
   */
  check() {
    // Already resolved.
    if (!this.configResolver_) {
      return null;
    }
    let config = this.metaParser_.check();
    if (!config) {
      config = this.ldParser_.check();
    }
    if (!config) {
      config = this.microdataParser_.check();
    }
    if (config) {
      // Product ID has been found: initialize the rest of the config.
      this.configResolver_(config);
      this.configResolver_ = null;
    } else if (this.doc_.isReady()) {
      this.configResolver_(
        Promise.reject(
          user().createError('No config could be discovered in the page')
        )
      );
      this.configResolver_ = null;
    }
    debugLog(config);
    return config;
  }
}

class TypeChecker {
  constructor() {}

  /**
   * Check value from json
   * @param {?Array|string} value
   * @param {Array<string>} expectedTypes
   * @return {boolean}
   */
  checkValue(value, expectedTypes) {
    if (!value) {
      return false;
    }
    return this.checkArray(this.toArray_(value), expectedTypes);
  }

  /**
   * Checks space delimited list of types
   * @param {?string} itemtype
   * @param {Array<string>} expectedTypes
   * @return {boolean}
   */
  checkString(itemtype, expectedTypes) {
    if (!itemtype) {
      return false;
    }
    return this.checkArray(itemtype.split(/\s+/), expectedTypes);
  }

  /**
   * @param {Array<?string>} typeArray
   * @param {Array<string>} expectedTypes
   * @return {boolean}
   */
  checkArray(typeArray, expectedTypes) {
    let found = false;
    typeArray.forEach((candidateType) => {
      found =
        found ||
        expectedTypes.includes(
          candidateType.replace(/^http:\/\/schema.org\//i, '')
        );
    });
    return found;
  }

  /*
   * @param {?Array|string} value
   * @return {Array}
   * @private
   */
  toArray_(value) {
    return Array.isArray(value) ? value : [value];
  }
}

class MetaParser {
  /**
   * @param {!Doc} doc
   */
  constructor(doc) {
    /** @private @const {!Doc} */
    this.doc_ = doc;
  }

  /**
   * @return {?PageConfig}
   */
  check() {
    if (!this.doc_.getBody()) {
      // Wait until the whole `<head>` is parsed.
      return null;
    }

    // Try to find product id.
    const productId = getMetaTag(
      this.doc_.getRootNode(),
      'subscriptions-product-id'
    );
    if (!productId) {
      return null;
    }

    // Is locked?
    const accessibleForFree = getMetaTag(
      this.doc_.getRootNode(),
      'subscriptions-accessible-for-free'
    );
    const locked = !!(
      accessibleForFree && accessibleForFree.toLowerCase() === 'false'
    );

    return new PageConfig(productId, locked);
  }
}

class JsonLdParser {
  /**
   * @param {!Doc} doc
   */
  constructor(doc) {
    /** @private @const {!Doc} */
    this.doc_ = doc;
    /** @private @const @function */
    this.checkType_ = new TypeChecker();
  }

  /**
   * @return {?PageConfig}
   */
  check() {
    if (!this.doc_.getBody()) {
      // Wait until the whole `<head>` is parsed.
      return null;
    }

    const domReady = this.doc_.isReady();

    // type: 'application/ld+json'
    const elements = this.doc_
      .getRootNode()
      .querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (
        element[ALREADY_SEEN] ||
        !element.textContent ||
        (!domReady && !hasNextNodeInDocumentOrder(element))
      ) {
        continue;
      }
      element[ALREADY_SEEN] = true;
      if (!RE_ALLOWED_TYPES.test(element.textContent)) {
        continue;
      }
      const possibleConfig = this.tryExtractConfig_(element);
      if (possibleConfig) {
        return possibleConfig;
      }
    }
    return null;
  }

  /**
   * @param {!Element} element
   * @return {?PageConfig}
   */
  tryExtractConfig_(element) {
    let possibleConfigs = tryParseJson(element.textContent);
    if (!possibleConfigs) {
      return null;
    }

    // Support arrays of JSON objects.
    if (!Array.isArray(possibleConfigs)) {
      possibleConfigs = [possibleConfigs];
    }

    let configs = /** @type {!Array<!JsonObject>} */ (possibleConfigs);
    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];

      if (config['@graph'] && Array.isArray(config['@graph'])) {
        configs = configs.concat(config['@graph']);
      }

      // Must be an ALLOWED_TYPE
      if (!this.checkType_.checkValue(config['@type'], ALLOWED_TYPES)) {
        continue;
      }

      // Must have a isPartOf[@type=Product].
      let productId = null;
      const partOfArray = this.valueArray_(config, 'isPartOf');
      if (partOfArray) {
        for (let j = 0; j < partOfArray.length; j++) {
          productId = this.discoverProductId_(partOfArray[j]);
          if (productId) {
            break;
          }
        }
      }
      if (!productId) {
        continue;
      }

      // Found product id, just check for the access flag.
      const isAccessibleForFree = this.bool_(
        this.singleValue_(config, 'isAccessibleForFree'),
        /* default */ true
      );

      return new PageConfig(productId, !isAccessibleForFree);
    }

    return null;
  }

  /**
   * @param {*} value
   * @param {boolean} def
   * @return {boolean}
   */
  bool_(value, def) {
    if (value == null || value === '') {
      return def;
    }
    if (typeof value == 'boolean') {
      return value;
    }
    if (typeof value == 'string') {
      const lowercase = value.toLowerCase();
      if (lowercase == 'false') {
        return false;
      }
      if (lowercase == 'true') {
        return true;
      }
    }
    return def;
  }

  /**
   * @param {!Object} json
   * @return {?string}
   */
  discoverProductId_(json) {
    // Must have type `Product`.
    if (!this.checkType_.checkValue(json['@type'], ['Product'])) {
      return null;
    }
    return /** @type {?string} */ (this.singleValue_(json, 'productID'));
  }

  /**
   * @param {!Object} json
   * @param {string} name
   * @return {?Array}
   */
  valueArray_(json, name) {
    const value = json[name];
    if (value == null || value === '') {
      return null;
    }
    return Array.isArray(value) ? value : [value];
  }

  /**
   * @param {!Object} json
   * @param {string} name
   * @return {*}
   */
  singleValue_(json, name) {
    const valueArray = this.valueArray_(json, name);
    const value = valueArray && valueArray[0];
    return value == null || value === '' ? null : value;
  }
}

class MicrodataParser {
  /**
   * @param {!Doc} doc
   */
  constructor(doc) {
    /** @private @const {!Doc} */
    this.doc_ = doc;
    /** @private {?boolean} */
    this.access_ = null;
    /** @private {?string} */
    this.productId_ = null;
    /** @private @const @function */
    this.checkType_ = new TypeChecker();
  }

  /**
   * Returns false if access is restricted, otherwise true
   * @param {!Element} root An element that is an item of type in ALLOWED_TYPES list
   * @return {?boolean} locked access
   * @private
   */
  discoverAccess_(root) {
    const ALREADY_SEEN = 'alreadySeenForAccessInfo';
    const nodeList = root.querySelectorAll("[itemprop='isAccessibleForFree']");
    for (let i = 0; nodeList[i]; i++) {
      const element = nodeList[i];
      const content = element.getAttribute('content') || element.textContent;
      if (!content) {
        continue;
      }
      if (this.isValidElement_(element, root, ALREADY_SEEN)) {
        let accessForFree = null;
        if (content.toLowerCase() == 'true') {
          accessForFree = true;
        } else if (content.toLowerCase() == 'false') {
          accessForFree = false;
        }
        return accessForFree;
      }
    }
    return null;
  }

  /**
   * Verifies if an element is valid based on the following
   * - child of an item of one the the ALLOWED_TYPES
   * - not a child of an item of any other type
   * - not seen before, marked using the alreadySeen tag
   * @param {?Element} current the element to be verified
   * @param {!Element} root the parent to track up to
   * @param {!string} alreadySeen used to tag already visited nodes
   * @return {!boolean} valid node
   * @private
   */
  isValidElement_(current, root, alreadySeen) {
    for (
      let node = current;
      node && !node[alreadySeen];
      node = node.parentNode
    ) {
      node[alreadySeen] = true;
      // document nodes don't have hasAttribute
      if (node.hasAttribute && node.hasAttribute('itemscope')) {
        /**{?string} */
        const type = node.getAttribute('itemtype');
        return this.checkType_.checkString(type, ALLOWED_TYPES);
      }
    }
    return false;
  }

  /**
   * Obtains the product ID that meets the requirements
   * - child of an item of one of ALLOWED_TYPES
   * - Not a child of an item of type 'Section'
   * - child of an item of type 'productID'
   * @param {!Element} root An element that is an item of an ALLOWED_TYPES
   * @return {?string} product ID, if found
   * @private
   */
  discoverProductId_(root) {
    const ALREADY_SEEN = 'alreadySeenForProductInfo';
    const nodeList = root.querySelectorAll('[itemprop="productID"]');
    for (let i = 0; nodeList[i]; i++) {
      const element = nodeList[i];
      const content = element.getAttribute('content') || element.textContent;
      const item = element.closest('[itemtype][itemscope]');
      const type = item.getAttribute('itemtype');
      if (type.indexOf('http://schema.org/Product') <= -1) {
        continue;
      }
      if (this.isValidElement_(item.parentElement, root, ALREADY_SEEN)) {
        return content;
      }
    }
    return null;
  }

  /**
   * Returns PageConfig if available
   * @return {?PageConfig} PageConfig found so far
   */
  getPageConfig_() {
    let locked = null;
    if (this.access_ != null) {
      locked = !this.access_;
    } else if (this.doc_.isReady()) {
      // Default to unlocked
      locked = false;
    }
    if (this.productId_ != null && locked != null) {
      return new PageConfig(this.productId_, locked);
    }
    return null;
  }

  /**
   * Extracts page config from Microdata in the DOM
   * @return {?PageConfig} PageConfig found
   */
  tryExtractConfig_() {
    let config = this.getPageConfig_();
    if (config) {
      return config;
    }

    // Grab all the nodes with an itemtype and filter for our allowed types
    const nodeList = Array.prototype.slice
      .call(this.doc_.getRootNode().querySelectorAll('[itemscope][itemtype]'))
      .filter((node) =>
        this.checkType_.checkString(
          node.getAttribute('itemtype'),
          ALLOWED_TYPES
        )
      );

    for (let i = 0; nodeList[i] && config == null; i++) {
      const element = nodeList[i];
      if (this.access_ == null) {
        this.access_ = this.discoverAccess_(element);
      }
      if (!this.productId_) {
        this.productId_ = this.discoverProductId_(element);
      }
      config = this.getPageConfig_();
    }
    return config;
  }

  /**
   * @return {?PageConfig}
   */
  check() {
    if (!this.doc_.getBody()) {
      // Wait until the whole `<head>` is parsed.
      return null;
    }
    return this.tryExtractConfig_();
  }
}

/**
 * @param {!Node} rootNode
 * @return {?string}
 */
export function getControlFlag(rootNode) {
  // Look for the flag in `meta`.
  const flag = getMetaTag(rootNode, CONTROL_FLAG);
  if (flag) {
    return flag;
  }
  // Look for the flag in `script`.
  const el = rootNode.querySelector(`script[${CONTROL_FLAG}]`);
  if (el) {
    return el.getAttribute(CONTROL_FLAG);
  }
  return null;
}

/**
 * Returns the value from content attribute of a meta tag with given name.
 *
 * If multiple tags are found, the first value is returned.
 *
 * @param {!Node} rootNode
 * @param {string} name The tag name to look for.
 * @return {?string} attribute value or empty string.
 * @private
 */
function getMetaTag(rootNode, name) {
  const el = rootNode.querySelector(`meta[name="${name}"]`);
  if (el) {
    return el.getAttribute('content');
  }
  return null;
}

/** @package Visible for testing only. */
export function getDocClassForTesting() {
  return Doc;
}
