class PlexAccountData:
    def __init__(self):
        self.tokens = {}
        self.servers = []
        self.libraries = []
        self.token = None
        self.selected_server = None

    def add_token(self, server_name, token):
        self.tokens[server_name] = token

    def set_servers(self, servers):
        self.servers = servers

    def set_libraries(self, libraries):
        self.libraries = libraries

    def set_token(self, token):
        self.token = token

    def set_selected_server(self, server):
        self.selected_server = server

    def set_selected_library(self, library):
        self.selected_library = library