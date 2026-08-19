"""Tool schemas — what the LLM reads to decide when to call each tool."""

PROFILES = {
    "name": "agent_branch_profiles",
    "description": (
        "List the Hermes profiles on this machine with their skill counts and "
        "configuration quality scores. Use this to discover which profiles "
        "exist before analysing or evaluating one."
    ),
    "parameters": {"type": "object", "properties": {}},
}

ANALYZE = {
    "name": "agent_branch_analyze",
    "description": (
        "Run an offline profile analysis on a Hermes profile: deterministic "
        "findings about its configuration (config.yaml, persona, memory, and "
        "every skill's frontmatter and body) with file/line evidence, an "
        "actionable fix per finding, and a 0-100 quality score. Costs no "
        "tokens. Use when asked to review, audit, or improve a profile's "
        "configuration or its skills."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "profile": {
                "type": "string",
                "description": "Profile name ('default' or a named profile). Defaults to 'default'.",
            },
        },
    },
}

TRIGGERING_EVAL = {
    "name": "agent_branch_triggering_eval",
    "description": (
        "Run a triggering eval for one skill in a Hermes profile: does the "
        "skill fire on prompts that should select it and stay silent on "
        "near-miss prompts that should not, judged against the profile's "
        "other skills? Makes multiple model calls (costs tokens) and returns "
        "plain-language Insights plus the hit totals. Use when asked whether "
        "a skill triggers correctly or overlaps with its siblings."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "skill": {
                "type": "string",
                "description": "The skill's directory name inside the profile's skills/ folder.",
            },
            "profile": {
                "type": "string",
                "description": "Profile name ('default' or a named profile). Defaults to 'default'.",
            },
        },
        "required": ["skill"],
    },
}
