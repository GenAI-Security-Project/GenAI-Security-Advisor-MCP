# GenAI Security Advisor — MCP Server

Bring OWASP GenAI Security Project research directly into your AI agent/assistant using the Model Context Protocol (MCP).

The **GenAI Security Advisor MCP Server** gives MCP-compatible AI assistants access to the OWASP GenAI Security Project's curated security research without requiring you to download or maintain the research repository locally.

Connect the server to your MCP-compatible AI agent/assistant or application, then ask GenAI security questions as part of your normal workflow.

---

## What Can I Use It For?

Use the GenAI Security Advisor MCP Server when you want your AI assistant to find and use OWASP GenAI Security Project research while helping you analyze, design, build, or secure Generative AI applications.

For example, you can ask:

> What are the key security risks for an AI agent that can call tools?

> What OWASP guidance applies to prompt injection?

> Find OWASP GenAI Security Project research related to MCP security.

> What security controls should I consider when an LLM can access sensitive enterprise data?

You can also provide your own architecture, application requirements, code, or security scenario and ask your AI assistant to use OWASP research when analyzing it.

For example:

> Review this AI agent architecture and identify the relevant OWASP GenAI security risks and recommended mitigations.

The MCP server provides access to the research corpus. Your AI assistant can then use that research as context when answering your questions.

---

# Why Use the MCP Server?

General-purpose AI models may not always contain the latest OWASP GenAI Security Project research in their built-in knowledge.

The MCP Server gives your AI assistant access to a curated collection of OWASP GenAI Security Project resources.

Your AI assistant can use the server to:

- Search GenAI security research
- Discover relevant OWASP resources
- Browse research by initiative
- Read individual research documents
- Retrieve resource and source information
- Incorporate OWASP research into its answers

The MCP Server accesses the same research corpus used by the **GenAI Security Advisor Agent Skill**, but makes that research available remotely through MCP.

---

# Getting Started

## 1. Use an MCP-Compatible AI Assistant

You need an AI assistant, agent, development environment, or application that supports the **Model Context Protocol (MCP)** and remote MCP servers using Streamable HTTP.

Because the GenAI Security Advisor is a remote MCP server, you do **not** need to clone the research repository or install the corpus locally.

## 2. Connect the MCP Server

The MCP endpoint follows this format:

```text
https://<server-address>/mcp
```

Add this endpoint to your MCP-compatible client.

For example, with Claude Code:

```bash
claude mcp add --transport http genai-security-advisor https://<server-address>/mcp
```

Replace `<server-address>` with the address of the GenAI Security Advisor MCP Server deployment you want to use.

Once connected, your AI assistant should discover the GenAI Security Advisor tools automatically.

---

# Using the GenAI Security Advisor

Once connected, you normally don't need to call individual MCP tools yourself.

Ask your AI assistant questions naturally and tell it to use the **GenAI Security Advisor** or **OWASP GenAI Security Project research** when appropriate.

### Find security guidance

> Search the OWASP GenAI Security Project research for guidance on prompt injection.

### Explore a security topic

> What OWASP GenAI resources address agentic AI security?

### Explore an initiative

> What resources are available from the OWASP GenAI Security Project's Agentic Security initiative?

### Research MCP security

> Search the OWASP GenAI Security Project corpus for MCP security risks and recommended controls.

### Analyze your architecture

> I'm building an AI agent that can access internal databases and call external APIs.
>
> Use OWASP GenAI Security Project research to identify the primary security risks and recommended mitigations.

### Investigate a specific risk

> What OWASP GenAI Security Project guidance applies when an AI agent can execute tools with elevated permissions?

---

# Available Research Tools

The MCP Server provides several tools that your AI assistant can use automatically.

| Tool | What It Does |
|---|---|
| `search_corpus` | Searches OWASP GenAI Security Project research for relevant content |
| `list_resources` | Discovers resources in the research corpus |
| `list_initiatives` | Shows available initiatives and their resources |
| `get_resource` | Retrieves information and available files for a specific resource |
| `get_file` | Reads supported research files |
| `get_corpus_revision` | Returns the exact commit SHA the server is currently serving answers from |

Every result that carries research content (`list_resources`, `get_resource`,
`get_file`, `search_corpus`) includes a `source_revision` field: the exact
commit SHA of the source repo ref the answer was read from, so a consumer can
record which revision answered a request (and `get_corpus_revision` returns
the same value on its own, with a commit URL).

In most cases, **you do not need to invoke these tools manually**.

Your AI assistant can determine which tools to use based on your question.

---

# Getting Better Answers

The more context you provide, the more useful the security analysis can be.

Instead of asking:

> How do I secure AI?

Try:

> I'm designing an enterprise AI agent that can retrieve confidential documents and call internal APIs.
>
> Search the OWASP GenAI Security Project research for security risks relevant to this architecture. Organize the findings by risk and include recommended mitigations.

Useful context can include:

- Type of AI application
- Whether the application uses AI agents
- Models being used
- Tools or APIs available to the model
- Data accessible to the model
- Authentication and authorization model
- MCP servers being used
- Trust boundaries
- Deployment architecture
- Security requirements
- Relevant application code

---

# Ask for Sources

For security decisions, ask your AI assistant to identify the OWASP resources supporting its recommendations.

For example:

> Which OWASP GenAI Security Project resources support these recommendations?

or:

> For each security risk, identify the OWASP resource that discusses it.

or:

> Separate recommendations derived from OWASP GenAI Security Project research from your general security recommendations.

This makes it easier to understand which guidance comes from the OWASP research corpus.

---

# Understanding Search Results

Some OWASP GenAI Security Project resources are published as PDFs.

To make these resources searchable, text may be extracted from the original PDFs and made available to the MCP search capability.

These text extractions are intended for **search and discovery**.

They may not preserve:

- Tables
- Diagrams
- Page layout
- Formatting
- Other visual information

When accuracy or citation is important, refer to the original OWASP source document rather than relying exclusively on extracted PDF text.

---

# MCP Server vs. GenAI Security Advisor Agent Skill

There are two ways to give an AI agent access to the GenAI Security Advisor research corpus.

| | MCP Server | Agent Skill |
|---|---|---|
| Best for | Remote access | Local repository access |
| Repository required locally | No | Yes |
| MCP support required | Yes | No |
| Access | Remote HTTP | Local |
| Research corpus | OWASP GenAI Security Project corpus | Same corpus |

### Use the MCP Server when:

You want an MCP-compatible AI assistant or application to access the research remotely without maintaining the research repository locally.

### Use the Agent Skill when:

You are working with an AI coding agent that already has the GenAI Security Advisor repository available locally.

---

# Security Considerations

The GenAI Security Advisor MCP Server provides **read-only access to security research**.

Its tools are designed to:

- Search research
- Discover resources
- Retrieve resource information
- Read research content

The MCP server does not provide tools for modifying the OWASP research corpus.

As with any MCP server, your MCP client or AI assistant determines what information is included in tool requests.

Follow your organization's policies when connecting AI assistants to external MCP servers, particularly when working with confidential application information, source code, credentials, or other sensitive data.

---

# Contributing and Getting Help

The GenAI Security Advisor is part of the **OWASP GenAI Security Project** and welcomes community participation.

For questions about connecting to the MCP server, using the GenAI Security Advisor, MCP client compatibility, research resources, troubleshooting, feature ideas, or contributing, join the OWASP GenAI Security Project community and visit:

**`#team-genai-security-advisor`**

Contributions are welcome, including improvements to:

- MCP functionality
- Search and resource discovery
- Documentation
- Usage examples
- MCP client compatibility
- New capabilities

---

# Licensing

The MCP server's code, configuration, scripts, and documentation are licensed under **Apache-2.0**.

Research made available through the server retains the license of the original OWASP GenAI Security Project resource.

Much of the OWASP GenAI Security Project research is licensed under **CC BY-SA 4.0**.

Review the applicable source and licensing information before redistributing research retrieved through the server.

---

# Learn More

- [OWASP GenAI Security Project](https://genai.owasp.org)
- [GenAI Security Advisor](https://github.com/GenAI-Security-Project/GenAI-Security-Advisor)
- [GenAI Security Advisor MCP Server](https://github.com/GenAI-Security-Project/GenAI-Security-Advisor-MCP)
- [Model Context Protocol](https://modelcontextprotocol.io)

---

# Quick Start

1. **Use an AI assistant that supports MCP.**
2. **Add the GenAI Security Advisor MCP endpoint.**
3. **Verify that the server is connected.**
4. **Ask your GenAI security question.**
5. **Tell your assistant to use OWASP GenAI Security Project research.**
6. **Ask it to identify the supporting OWASP resources.**

Example:

> Use the OWASP GenAI Security Project research available through the GenAI Security Advisor MCP Server to identify the key security risks in this AI agent architecture and recommend mitigations.

**Connect once. Ask questions in your normal AI workflow. Bring OWASP GenAI Security Project research directly into your AI security analysis.**
