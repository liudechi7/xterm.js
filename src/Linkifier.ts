/**
 * @license MIT
 */

import { ILinkMatcherOptions, ITerminal, IBufferAccessor } from './Interfaces';
import { LinkMatcher, LinkMatcherHandler, LinkMatcherValidationCallback, LineData } from './Types';
import { IMouseZoneManager } from './input/Interfaces';
import { MouseZone } from './input/MouseZoneManager';

const INVALID_LINK_CLASS = 'xterm-invalid-link';

const protocolClause = '(https?:\\/\\/)';
const domainCharacterSet = '[\\da-z\\.-]+';
const negatedDomainCharacterSet = '[^\\da-z\\.-]+';
const domainBodyClause = '(' + domainCharacterSet + ')';
const tldClause = '([a-z\\.]{2,6})';
const ipClause = '((\\d{1,3}\\.){3}\\d{1,3})';
const localHostClause = '(localhost)';
const portClause = '(:\\d{1,5})';
const hostClause = '((' + domainBodyClause + '\\.' + tldClause + ')|' + ipClause + '|' + localHostClause + ')' + portClause + '?';
const pathClause = '(\\/[\\/\\w\\.\\-%~]*)*';
const queryStringHashFragmentCharacterSet = '[0-9\\w\\[\\]\\(\\)\\/\\?\\!#@$%&\'*+,:;~\\=\\.\\-]*';
const queryStringClause = '(\\?' + queryStringHashFragmentCharacterSet + ')?';
const hashFragmentClause = '(#' + queryStringHashFragmentCharacterSet + ')?';
const negatedPathCharacterSet = '[^\\/\\w\\.\\-%]+';
const bodyClause = hostClause + pathClause + queryStringClause + hashFragmentClause;
const start = '(?:^|' + negatedDomainCharacterSet + ')(';
const end = ')($|' + negatedPathCharacterSet + ')';
const strictUrlRegex = new RegExp(start + protocolClause + bodyClause + end);

/**
 * The ID of the built in http(s) link matcher.
 */
const HYPERTEXT_LINK_MATCHER_ID = 0;

/**
 * The Linkifier applies links to rows shortly after they have been refreshed.
 */
export class Linkifier {
  /**
   * The time to wait after a row is changed before it is linkified. This prevents
   * the costly operation of searching every row multiple times, potentially a
   * huge amount of times.
   */
  protected static TIME_BEFORE_LINKIFY = 200;

  protected _linkMatchers: LinkMatcher[] = [];

  private _mouseZoneManager: IMouseZoneManager;
  private _rowsTimeoutId: number;
  private _nextLinkMatcherId = HYPERTEXT_LINK_MATCHER_ID;

  constructor(
    private _terminal: IBufferAccessor
  ) {
    this.registerLinkMatcher(strictUrlRegex, null, { matchIndex: 1 });
  }

  /**
   * Attaches the linkifier to the DOM, enabling linkification.
   * @param mouseZoneManager The mouse zone manager to register link zones with.
   */
  public attachToDom(mouseZoneManager: IMouseZoneManager): void {
    this._mouseZoneManager = mouseZoneManager;
  }

  /**
   * Queue linkification on a set of rows.
   * @param start The row to linkify from (inclusive).
   * @param end The row to linkify to (inclusive).
   */
  public linkifyRows(start: number, end: number): void {
    // Don't attempt linkify if not yet attached to DOM
    if (!this._mouseZoneManager) {
      return;
    }

    // Clear out any existing links
    this._mouseZoneManager.clearAll();

    if (this._rowsTimeoutId) {
      clearTimeout(this._rowsTimeoutId);
    }
    this._rowsTimeoutId = setTimeout(this._linkifyRows.bind(this, start, end), Linkifier.TIME_BEFORE_LINKIFY);
  }

  /**
   * Linkifies
   * @param start The row to start at.
   * @param end The row to end at.
   */
  private _linkifyRows(start: number, end: number): void {
    this._rowsTimeoutId = null;
    for (let i = start; i <= end; i++) {
      this._linkifyRow(i);
    }
  }

  /**
   * Attaches a handler for hypertext links, overriding default <a> behavior for
   * tandard http(s) links.
   * @param handler The handler to use, this can be cleared with null.
   */
  public setHypertextLinkHandler(handler: LinkMatcherHandler): void {
    this._linkMatchers[HYPERTEXT_LINK_MATCHER_ID].handler = handler;
  }

  /**
   * Attaches a validation callback for hypertext links.
   * @param callback The callback to use, this can be cleared with null.
   */
  public setHypertextValidationCallback(callback: LinkMatcherValidationCallback): void {
    this._linkMatchers[HYPERTEXT_LINK_MATCHER_ID].validationCallback = callback;
  }

  /**
   * Registers a link matcher, allowing custom link patterns to be matched and
   * handled.
   * @param regex The regular expression to search for. Specifically, this
   * searches the textContent of the rows. You will want to use \s to match a
   * space ' ' character for example.
   * @param handler The callback when the link is called.
   * @param options Options for the link matcher.
   * @return The ID of the new matcher, this can be used to deregister.
   */
  public registerLinkMatcher(regex: RegExp, handler: LinkMatcherHandler, options: ILinkMatcherOptions = {}): number {
    if (this._nextLinkMatcherId !== HYPERTEXT_LINK_MATCHER_ID && !handler) {
      throw new Error('handler must be defined');
    }
    const matcher: LinkMatcher = {
      id: this._nextLinkMatcherId++,
      regex,
      handler,
      matchIndex: options.matchIndex,
      validationCallback: options.validationCallback,
      hoverStartCallback: options.hoverStartCallback,
      hoverEndCallback: options.hoverEndCallback,
      priority: options.priority || 0
    };
    this._addLinkMatcherToList(matcher);
    return matcher.id;
  }

  /**
   * Inserts a link matcher to the list in the correct position based on the
   * priority of each link matcher. New link matchers of equal priority are
   * considered after older link matchers.
   * @param matcher The link matcher to be added.
   */
  private _addLinkMatcherToList(matcher: LinkMatcher): void {
    if (this._linkMatchers.length === 0) {
      this._linkMatchers.push(matcher);
      return;
    }

    for (let i = this._linkMatchers.length - 1; i >= 0; i--) {
      if (matcher.priority <= this._linkMatchers[i].priority) {
        this._linkMatchers.splice(i + 1, 0, matcher);
        return;
      }
    }

    this._linkMatchers.splice(0, 0, matcher);
  }

  /**
   * Deregisters a link matcher if it has been registered.
   * @param matcherId The link matcher's ID (returned after register)
   * @return Whether a link matcher was found and deregistered.
   */
  public deregisterLinkMatcher(matcherId: number): boolean {
    // ID 0 is the hypertext link matcher which cannot be deregistered
    for (let i = 1; i < this._linkMatchers.length; i++) {
      if (this._linkMatchers[i].id === matcherId) {
        this._linkMatchers.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Linkifies a row.
   * @param rowIndex The index of the row to linkify.
   */
  private _linkifyRow(rowIndex: number): void {
    const absoluteRowIndex = this._terminal.buffer.ydisp + rowIndex;
    if (absoluteRowIndex >= this._terminal.buffer.lines.length) {
      return;
    }
    const text = this._terminal.buffer.translateBufferLineToString(absoluteRowIndex, false);
    for (let i = 0; i < this._linkMatchers.length; i++) {
      this._doLinkifyRow(rowIndex, text, this._linkMatchers[i]);
    }
  }

  /**
   * Linkifies a row given a specific handler.
   * @param rowIndex The row index to linkify.
   * @param text The text of the row (excludes text in the row that's already
   * linkified).
   * @param matcher The link matcher for this line.
   * @param offset The how much of the row has already been linkified.
   * @return The link element(s) that were added.
   */
  private _doLinkifyRow(rowIndex: number, text: string, matcher: LinkMatcher, offset: number = 0): void {
    // Iterate over nodes as we want to consider text nodes
    let result = [];
    const isHttpLinkMatcher = matcher.id === HYPERTEXT_LINK_MATCHER_ID;

    // Find the first match
    let match = text.match(matcher.regex);
    if (!match || match.length === 0) {
      return;
    }
    let uri = match[typeof matcher.matchIndex !== 'number' ? 0 : matcher.matchIndex];

    // Get index, match.index is for the outer match which includes negated chars
    const index = text.indexOf(uri);

    // Ensure the link is valid before registering
    if (matcher.validationCallback) {
      matcher.validationCallback(text, isValid => {
        // Discard link if the line has already changed
        if (this._rowsTimeoutId) {
          return;
        }
        if (isValid) {
          this._addLink(offset + index, rowIndex, uri, matcher);
        }
      });
    } else {
      this._addLink(offset + index, rowIndex, uri, matcher);
    }

    // Recursively check for links in the rest of the text
    const remainingStartIndex = index + uri.length;
    const remainingText = text.substr(remainingStartIndex);
    if (remainingText.length > 0) {
      this._doLinkifyRow(rowIndex, remainingText, matcher, offset + remainingStartIndex);
    }
  }

  /**
   * Registers a link to the mouse zone manager.
   * @param x The column the link starts.
   * @param y The row the link is on.
   * @param uri The URI of the link.
   * @param matcher The link matcher for the link.
   */
  private _addLink(x: number, y: number, uri: string, matcher: LinkMatcher): void {
    this._mouseZoneManager.add(new MouseZone(
      x + 1,
      x + 1 + uri.length,
      y + 1,
      e => {
        if (matcher.handler) {
          return matcher.handler(e, uri);
        }
        window.open(uri, '_blank');
      },
      e => {
        if (matcher.hoverStartCallback) {
          matcher.hoverStartCallback(e, uri);
        }
      },
      () => {
        if (matcher.hoverEndCallback) {
          matcher.hoverEndCallback();
        }
      }
    ));
  }
}
