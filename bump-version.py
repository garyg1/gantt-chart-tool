import re
import datetime

with open("./index.html", "r") as f:
    html = "".join(f.readlines())
BEGIN_TAG = "<!-- begin autogenerated -->"
END_TAG = "<!-- end autogenerated -->"

year = datetime.datetime.today().year
yyyymmdd = datetime.datetime.today().strftime("%Y-%m-%d")

GENERATED = f"""{BEGIN_TAG}
            <small>&copy; {year} Gary Gurlaskie</small><br />
            <small>Gantt Chart Maker v{yyyymmdd}.1</small><br />
            {END_TAG}"""

regex = f"{BEGIN_TAG}.*{END_TAG}"
blocks = re.split(regex, html, flags=re.MULTILINE | re.DOTALL)

new_html = GENERATED.join(blocks)

with open("./index.html", "w") as f:
    f.write(new_html)