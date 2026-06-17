from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///sigil_dev.db"
    redis_url: str = "redis://localhost:6379"

    polygon_api_key: str = ""
    finnhub_api_key: str = ""
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    demo_mode: bool = True
    auto_run_pipeline: bool = True
    pipeline_interval_hours: float = 6
    auth_password: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
