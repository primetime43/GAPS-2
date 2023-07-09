import importlib

app = importlib.import_module("GAPS 2").app

if __name__ == "__main__":
    app.run(host='0.0.0.0')
