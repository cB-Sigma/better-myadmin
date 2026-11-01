.. _query_tabs:

Query tabs
==========

The :guilabel:`SQL` tab of the server, a database or a table can hold several queries at once, each
in its own tab, as in a desktop database client. This is a BetterMyAdmin addition: phpMyAdmin has
one query box per page.

With a single tab the page is phpMyAdmin's query box; only a small :guilabel:`+ New tab` button
above the box is added. From two tabs on a tab strip shows above the box:

* :guilabel:`+` opens a new, empty tab after the one shown.
* Each tab keeps its own query, its results, the state of its query box (shown or hidden, the
  options below it) and its scroll position. A query that is still running when you switch to
  another tab finishes in its own tab; its :guilabel:`Cancel` button stays there.
* Double-click a tab (or press :kbd:`F2` on it) to rename it. An empty name gives the tab back its
  default name (:guilabel:`Query 2`, …).
* :guilabel:`×` or a middle click closes a tab. When its query was changed and not run since,
  you are asked first (unless :config:option:`$cfg['Confirm']` is off).
* The console, :guilabel:`Get auto-saved query`, bookmarks and the query history work as before
  and always act on the tab shown: the auto-saved query is the last query typed in any tab of
  the page.

Keyboard
--------

=====================  ====================================================
:kbd:`Ctrl+Alt+T`      open a new tab
:kbd:`Ctrl+Alt+W`      close the tab shown
:kbd:`←` / :kbd:`→`    move between tabs (when a tab has the focus);
                       :kbd:`Home` / :kbd:`End` go to the first / last one
:kbd:`F2`              rename the focused tab
:kbd:`Delete`          close the focused tab
:kbd:`Ctrl+Enter`      run the query of the tab shown, as before
=====================  ====================================================

Storage
-------

The tabs, their names and their queries are kept in the browser (``localStorage``), separately for
each server and for the server, each database and each table SQL page, so they come back after a
reload. Results are not kept. A single tab with its default name stores nothing. In a private
window, or when the browser blocks storage, the tabs still work but are not kept.
