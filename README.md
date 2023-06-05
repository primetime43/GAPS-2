# GAPS 2

GAPS 2 is a rewrite of the original [GAPS](https://github.com/JasonHHouse/gaps) project, now written in Python instead of Java. GAPS (Gaps A Plex Server) finds movies you're missing in your Plex Server. It's a great way to find additional movies that you might be interested in based on collections from movies in your Plex Server.

The GAPS 2 project aims to bring the same functionality with the simplicity and versatility of Python.

## Features

- Finds missing movies in Plex libraries based on collections
- Lists missing and existing movies within collections
- Easy to use interface
- Now written in Python for easy deployment and updates

## TODO

- [x] Add the back end functionality
- [x] Fix/finish overall functionality that's missing from the original code
- [ ] Need to add entire library recommendations
- [ ] Need to remove existing movies in plex library from recommendations
- [ ] Fix bugs & add updates to refactor code for simplicity

## Installation

Run the python file and it will be locally hosted at http://127.0.0.1:5000/

**Command on Windows for creating an exe out of the entire project from the main python file**
```
pyinstaller --onefile --add-data "config.py;." --add-data "templates;templates" --add-data "static;static" "GAPS 2.py"
```

## Images of v1.0.0
![image](https://github.com/primetime43/GAPS-2/assets/12754111/a9ae50f3-5a9a-4f93-bfdb-a90b6783a47f)
![image](https://github.com/primetime43/GAPS-2/assets/12754111/4466e0bf-70be-4ab7-b5c5-02140c31cae9)
![image](https://github.com/primetime43/GAPS-2/assets/12754111/be56426e-7c5f-492a-a852-04e4fc076bd9)

## Development

GAPS 2 is developed by [primetime43](https://github.com/primetime43). Contributions are welcome! Feel free to report bugs, suggest features, or contribute to the code.

Please report any bugs encountered. You can see a log output in the python console window that is opened when running the exe.
