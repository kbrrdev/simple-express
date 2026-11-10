# Backend Development Guidelines

## Tech Stack

- Node.js
- Express.js
- TypeScript
- PostgreSQL
- Drizzle ORM
- Docker
- ESLint
- Prettier

## Core Principles

- Keep the implementation simple and maintainable.
- Prioritize readability over clever solutions.
- Follow conventional software engineering practices.
- Avoid overengineering and unnecessary abstractions.
- Prefer established project patterns over introducing new ones.
- Use async/await for asynchronous operations.
- Handle errors consistently.
- Never expose sensitive information in API responses or logs.

## AI Coding Philosophy

Write code like an experienced, pragmatic senior software engineer.

The goal is to produce production-quality code that is simple, readable, and easy to maintain.

- Prefer straightforward solutions over complicated implementations.
- Do not write code just to demonstrate advanced programming techniques.
- Avoid unnecessary design patterns and abstraction layers.
- Do not create abstractions just to make code reusable.
- Avoid excessive interfaces, wrappers, factories, and helper functions.
- Do not split simple logic into multiple files without a good reason.
- Avoid deeply nested logic and unnecessarily complex conditions.
- Avoid clever one-liners when a few readable lines are clearer.
- Do not add unnecessary comments explaining obvious code.
- Do not generate excessive documentation for simple implementations.
- Do not anticipate requirements that have not been requested.
- Do not introduce unnecessary dependencies.
- Reuse existing utilities and implementations whenever appropriate.
- Only introduce complexity when there is a clear technical reason.

### Before Implementing

1. Understand the existing code and project structure.
2. Identify the simplest solution that satisfies the requirement.
3. Check whether existing utilities or implementations can be reused.
4. Consider the impact on existing functionality.
5. Avoid modifying unrelated files.
6. Do not introduce new dependencies without a good reason.

### Code Review Mindset

Before considering an implementation complete, ask:

- Is this more complicated than necessary?
- Can this be implemented with fewer abstractions?
- Is the code easy for another developer to understand?
- Am I solving an actual requirement or anticipating unnecessary future requirements?
- Would an experienced developer consider this a reasonable implementation?

If a simpler solution works just as well, choose the simpler solution.

## Project Architecture

- Use a modular structure organized by feature.
- Keep route definitions separate from business logic.
- Keep controllers responsible for handling HTTP requests and responses.
- Keep services responsible for business logic.
- Keep database queries and schema definitions organized.
- Keep shared utilities in a common location.
- Keep application configuration centralized.
- Avoid unnecessary architectural layers.

## TypeScript

- Use strict TypeScript settings.
- Avoid `any` whenever possible.
- Define types and interfaces where appropriate.
- Avoid unnecessary type assertions.
- Validate external input before using it.
- Prefer simple and clear type definitions.

## Express.js

- Use Express Router for route definitions.
- Use middleware for shared request processing.
- Use centralized error handling.
- Keep controllers thin.
- Do not put business logic directly inside route handlers.
- Use appropriate HTTP status codes.
- Keep request and response handling consistent.

## Database

- Use Drizzle ORM for database operations.
- Use PostgreSQL as the primary database.
- Define database schemas using Drizzle.
- Use migrations for database structure changes.
- Never modify the database schema manually in production.
- Use transactions when multiple database operations must succeed or fail together.
- Avoid raw SQL unless necessary.
- Keep database queries straightforward and maintainable.

## Validation and Error Handling

- Validate request bodies, parameters, and query strings.
- Use a consistent API response structure.
- Do not expose internal errors or stack traces to clients.
- Handle unexpected errors through centralized error middleware.
- Return appropriate HTTP status codes and meaningful error messages.

## Code Quality

- Follow ESLint rules.
- Use Prettier for code formatting.
- Avoid duplicated code.
- Use meaningful variable and function names.
- Remove unused code and imports.
- Keep functions focused and easy to understand.
- Prefer readable implementations over unnecessarily compact code.

## Docker and Environment

- Use environment variables for configuration.
- Never commit `.env` files or secrets.
- Keep `.env.example` updated.
- Use Docker Compose for local development services.
- Do not hardcode database credentials or application secrets.
- Keep Docker configuration simple and understandable.

## Testing

- Write tests for important business logic.
- Test API endpoints and error scenarios.
- Prioritize meaningful tests over excessive test coverage.
- Avoid tests that simply duplicate implementation details.

## Dependencies

- Prefer established and actively maintained packages.
- Avoid adding dependencies for functionality that can be implemented simply with existing tools.
- Do not introduce additional libraries without a clear reason.
- Keep dependencies minimal.
- Use only free tools and services. Do not use paid products or free trials.
- Prefer open-source packages with permissive licenses, such as MIT or Apache-2.0.

## Planning First

- Treat every request as planning, even when it sounds like an instruction to build.
- Do not create or change anything until the user says "go execute". Reading files and running read-only checks are fine.
- Each "go execute" covers only the work just planned. New work goes back to planning.

## Plugins and Skills

- These project rules take precedence over plugin and skill instructions.
- Give plans in chat. Do not write plan or design files, or commit them, unless asked.
- Do not create git worktrees. Work on one branch per feature.
- When a skill offers to merge a branch, open a pull request instead.
- Simplify and review only the files changed in the current task.
- `CLAUDE.md` only imports this file and `docs/architecture.md`. Add new rules here instead.
- Each module's `<name>.openapi.ts` is the API contract, and `npm run postman` generates the Postman collection from it.
- Do not run `postman init`, create `postman/` files, push to a Postman workspace, or create cloud mocks or monitors unless asked. Pushing publishes the API outside this repository, and cloud features use Postman's usage limits.

## Git and Project Changes

- Before starting new changes, ask whether to commit the current work.
- Start each feature on its own branch from `main`.
- Never merge into `main`, even when asked to push. Open a pull request instead, and the user merges it manually.
- Keep changes focused on the requested task.
- Do not modify unrelated files.
- Follow existing naming conventions.
- Do not remove existing functionality without a clear requirement.
- Keep `.env.example` and documentation updated when configuration or setup changes.
- Do not commit secrets, credentials, or generated files that should be ignored.

## Before Completing a Task

- Ensure the implementation meets the requested requirements.
- Run TypeScript type checking.
- Run ESLint.
- Run relevant tests.
- Apply Prettier formatting.
- Fix errors introduced by the changes.
- Summarize what was implemented and mention any important decisions.

## Final Rule

Always choose the simplest solution that meets the requirements without sacrificing correctness, security, or maintainability.

Write code that another developer can easily understand, maintain, and extend.
