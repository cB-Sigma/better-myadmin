.. _intro:

Introduction
============

BetterMyAdmin is a free software tool written in TypeScript that is intended to
handle the administration of a MySQL or MariaDB database server. It is a
feature-for-feature port of phpMyAdmin to Node.js and React: the same pages,
the same configuration directives (with the same names and defaults) and the
same Docker variables, with a modern interface and no PHP. You can use
BetterMyAdmin to perform most administration tasks, including creating a
database, running queries, and adding user accounts.

BetterMyAdmin runs as one Node.js process, or as the Docker image
``ghcr.io/cb-sigma/better-myadmin``, that serves both the web application and
its API; it needs no web server in front of it. The intentional differences
from phpMyAdmin are listed, each with its rationale, in the `parity exceptions
register
<https://github.com/cB-Sigma/better-myadmin/blob/main/docs/reference/parity-exceptions.md>`_.

Supported features
------------------

Currently BetterMyAdmin can:

* create, browse, edit, and drop databases, tables, views, columns, and indexes
* display multiple results sets through stored procedures or queries
* create, copy, drop, rename and alter databases, tables, columns and
  indexes
* maintenance server, databases and tables, with proposals on server
  configuration
* execute, edit and bookmark any :term:`SQL`-statement, even batch-queries
* load text files into tables
* create [#f1]_ and read dumps of tables
* export [#f1]_ data to various formats: :term:`CSV`, :term:`XML`, JSON,
  :term:`ISO`/:term:`IEC` 26300 - :term:`OpenDocument` Text and Spreadsheet, Microsoft
  Word 2000, LATEX, YAML and JavaScript module formats
* import data and :term:`MySQL` structures from :term:`OpenDocument` spreadsheets, as
  well as :term:`XML`, :term:`CSV`, and :term:`SQL` files
* administer multiple servers
* add, edit, and remove MySQL user accounts and privileges
* check referential integrity in MyISAM tables
* create graphics of your database layout (SVG, EPS and Dia)
* search globally in a database or a subset of it
* transform stored data into any format using a set of predefined
  functions, like displaying BLOB-data as image or download-link
* track changes on databases, tables and views
* support InnoDB tables and foreign keys
* create, edit, call, export and drop stored procedures and functions
* create, edit, export and drop events and triggers
* communicate in the languages of phpMyAdmin's translations

Shortcut keys
-------------

Currently BetterMyAdmin supports following shortcuts:

* k and CTRL+k - Toggle console
* CTRL+ALT+c   - Toggle console
* h - Go to home page
* s - Open the navigation panel settings
* e - Export
* d + s - Go to database structure (Provided you are in database related page)
* d + f - Search database (Provided you are in database related page)
* t + s - Go to table structure (Provided you are in table related page)
* t + f - Search table (Provided you are in table related page)
* backspace - Takes you to older page.
* ? - Show the list of shortcuts

A word about users
------------------

Many people have difficulty understanding the concept of user
management with regards to BetterMyAdmin. When a user logs in to
BetterMyAdmin, that username and password are passed directly to MySQL.
BetterMyAdmin does no account management on its own (other than allowing
one to manipulate the MySQL user account information); all users must
be valid MySQL users.

.. rubric:: Footnotes

.. [#f1]

    BetterMyAdmin can compress (:term:`ZIP`, :term:`GZip` or :term:`RFC 1952`
    formats) dumps and :term:`CSV` exports; the compression is built in and
    needs no extra software.
