from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env-driven config. Field names map to UPPER_SNAKE env vars."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_service_key: str = "dev-ai-key"

    # LLM (OpenAI-compatible, pluggable)
    llm_provider: str = "openai"
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model_large: str = "gpt-4o"
    llm_model_small: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"

    log_level: str = "INFO"


settings = Settings()
