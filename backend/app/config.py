from functools import lru_cache

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from the environment (or a local, git-ignored .env)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    session_secret: SecretStr
    field_encryption_key: SecretStr
    invite_codes: str = ""
    cors_origins: str = "http://localhost:5173"
    demo_mode: bool = True
    demo_retention_hours: int = 24

    database_url: str
    # Managed Postgres (Azure) requires TLS; local and CI databases don't.
    database_ssl: bool = False

    # The project environment stores the key as ANTHROPIC_RIVERSIDE_API_KEY; ANTHROPIC_API_KEY also works.
    anthropic_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("ANTHROPIC_RIVERSIDE_API_KEY", "ANTHROPIC_API_KEY")
    )
    anthropic_model: str = "claude-haiku-5-5"
    anthropic_effort: str = "low"
    anthropic_timeout_seconds: float = 6.0

    static_dir: str = "static"
    tesseract_cmd: str = "tesseract"
    max_upload_mb: int = Field(default=8, ge=1, le=20)

    @property
    def invite_code_set(self) -> set[str]:
        return {c.strip() for c in self.invite_codes.split(",") if c.strip()}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.anthropic_api_key and self.anthropic_api_key.get_secret_value())

    @property
    def secure_cookies(self) -> bool:
        return self.app_env != "development" and self.app_env != "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()
