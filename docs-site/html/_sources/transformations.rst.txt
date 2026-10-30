.. _transformations:

Transformations
===============

.. note::

    You need to have configured the :ref:`linked-tables` to use the transformations
    feature.

.. _transformationsintro:

Introduction
++++++++++++

To enable transformations, you have to set up the ``column_info``
table and the proper directives. Please see the :ref:`config` on how to do so.

BetterMyAdmin has two different types of transformations: browser display
transformations, which affect only how the data is shown when browsing
through BetterMyAdmin; and input transformations, which affect a value
prior to being inserted through BetterMyAdmin.
You can apply different transformations to the contents of each
column. Each transformation has options to define how it will affect the
stored data.

Say you have a column ``filename`` which contains a filename. Normally
you would see in BetterMyAdmin only this filename. Using display transformations
you can transform that filename into a HTML link, so you can click
inside of the BetterMyAdmin structure on the column's link and will see
the file displayed in a new browser window. Using transformation
options you can also specify strings to append/prepend to a string or
the format you want the output stored in.

For a general overview of all available transformations and their
options, you can either go to the ``Change`` link for an existing column
or from the dialog to create a new column, in either case there is a link
on that column structure page for "Browser display transformation" and
"Input transformation" which will show more information about each
transformation that is available on your system.

For a tutorial on how to effectively use transformations, see the
`Link section <https://www.phpmyadmin.net/docs/>`_ on the
official phpMyAdmin homepage: BetterMyAdmin's transformations are the same.

.. _transformationshowto:

Usage
+++++

Go to the table structure page (reached by clicking on
the 'Structure' link for a table). There click on "Change" (or the change
icon) and there you will see the five transformation--related fields at the end of the line.
They are called ':term:`Media type`', 'Browser transformation' and
'Transformation options'.

* The field ':term:`Media type`' is a drop-down field. Select the :term:`Media type` that
  corresponds to the column's contents. Please note that many transformations
  are inactive until a :term:`Media type` is selected.
* The field 'Browser display transformation' is a drop-down field. You can
  choose from a hopefully growing amount of pre-defined transformations.
  There are global transformations and mimetype-bound transformations.
  Global transformations can be used for any mimetype. They will take
  the mimetype, if necessary, into regard. Mimetype-bound
  transformations usually only operate on a certain mimetype. There are
  transformations which operate on the main mimetype (like 'image'),
  which will most likely take the subtype into regard, and those who
  only operate on a specific subtype (like 'image/jpeg'). You can use
  transformations on mimetypes for which the function was not defined
  for. There is no security check for you selected the right
  transformation, so take care of what the output will be like.
* The field 'Browser display transformation options' is a free-type textfield. You have
  to enter transform-function specific options here. Usually the
  transforms can operate with default options, but it is generally a
  good idea to look up the overview to see which options are necessary.
  Much like the ENUM/SET-Fields, you have to split up several options
  using the format 'a','b','c',...(NOTE THE MISSING BLANKS). This is
  because internally the options will be parsed as an array, leaving the
  first value the first element in the array, and so forth. If you want
  to specify a MIME character set you can define it in the
  transformation\_options. You have to put that outside of the pre-
  defined options of the specific mime-transform, as the last value of
  the set. Use the format "'; charset=XXX'". If you use a transform, for
  which you can specify 2 options and you want to append a character
  set, enter "'first parameter','second parameter','charset=us-ascii'".
  You can, however use the defaults for the parameters: "'','','charset
  =us-ascii'". The default options can be configured using
  :config:option:`$cfg['DefaultTransformations']`.
* 'Input transformation' is another drop-down menu that corresponds exactly
  with the instructions above for "Browser display transformation" except
  these affect the data before insertion in to the database. These are
  most commonly used to either provide a specialized editor (for example, using
  the BetterMyAdmin SQL editor interface) or selector (such as for uploading an image).
  It's also possible to manipulate the data such as converting an IPv4 address to binary
  or parsing it through a regular expression.
* Finally, 'Input transformation options' is the equivalent of the "Browser display
  transformation options" section above and is where optional and required parameters are entered.

.. _transformationsfiles:

File structure
++++++++++++++

BetterMyAdmin has phpMyAdmin's transformations, with the same names, options
and output, but they are not PHP plugin files: they are part of BetterMyAdmin's
TypeScript source code (:file:`packages/mysql-types/src/transformations.ts`
in the repository, with the editors of the input transformations in the web
application). phpMyAdmin's instructions for adding a transformation as a PHP
class under :file:`src/Plugins/Transformations/` (with its ``TEMPLATE`` files
and generator scripts) do not apply: to add a transformation to
BetterMyAdmin, change its source code and build it (see :ref:`developers`).

Because the user cannot enter their own mimetypes, it is kept certain that
the transformations will always work. It makes no sense to apply a
transformation to a mimetype the transform-function doesn't know to
handle.

The names keep phpMyAdmin's convention, ``[Mimetype]_[Subtype]_[Transformation
Name]`` (for example ``Text_Plain_Bool2Text`` or ``Image_JPEG_Inline``), so
that the transformations stored in the ``column_info`` table of the
:ref:`linked-tables` mean the same in phpMyAdmin and in BetterMyAdmin.

.. _transformations_external:

The External transformation
+++++++++++++++++++++++++++

The ``Text/Plain: External`` transformation passes the value of a cell to a
program on the server and shows the program's output. In phpMyAdmin, the
programs it may run are listed in the ``$allowedPrograms`` array of its PHP
plugin file, which an administrator edits. In BetterMyAdmin they are listed in
the :config:option:`$cfg['TransformationsExternalPrograms']` directive:

.. code-block:: json

    { "TransformationsExternalPrograms": ["/usr/bin/tidy -q"] }

The list is empty by default, as phpMyAdmin ships it: the transformation then
shows the value unchanged. The first option of the transformation chooses the
program by its position in the list (0 for the first one). The programs run
without a shell, with a time limit of 10 seconds and an output limit of
16 MiB; the deprecated second option can only add arguments to the program,
never shell syntax.

.. warning::

    Any user who can set a column's transformation options can add
    arguments to the program and feed it any cell value: list only programs
    that cannot write or read files through their arguments, or wrapper
    scripts that ignore them.
