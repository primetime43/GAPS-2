class PlexAccountData:
    def __init__(self):
        self.tokens: dict[str, str] = {}
        self.servers: list[str] = []
        self.libraries: list | dict = []
        self.token: str | None = None
        self.selected_server: str | None = None

    def add_token(self, server_name: str, token: str):
        self.tokens[server_name] = token

    def set_servers(self, servers: list[str]):
        self.servers = servers

    def set_libraries(self, libraries):
        self.libraries = libraries

    def set_token(self, token: str):
        self.token = token

    def set_selected_server(self, server: str):
        self.selected_server = server

    def to_dict(self) -> dict:
        return {
            'servers': self.servers,
            'libraries': self.libraries,
            'token': self.token,
            'selected_server': self.selected_server,
        }
