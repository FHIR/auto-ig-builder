#!/bin/bash

echo "<html><body><ul>" > index.html

for i in `find .`
do
    echo "<li><a href=\"$i\">$i</a></li>" >> index.html
done

echo "</ul></body></html>" >> index.html
