---
name: zalo-dev-workflow
description: Standard workflow for implementing features in the Zalo Clone Backend, ensuring compliance with contract-first architecture and strict verification rules.
---

# Zalo Clone Backend Development Workflow

Follow this workflow for ANY code change (feature, refactor, fix) in the Zalo Clone Backend monorepo. This ensures adherence to the Event-Driven Architecture and strict quality gates.

## Steps

1.  **Contract-First Definition (Mandatory)**
    Before writing any service logic, you MUST define the interfaces in `@libs/contracts`.
    - **Kafka Events**: Update `KafkaTopics` in `libs/contracts` and define payload interfaces.
    - **WebSocket Events**: Update `WsEvents` in `libs/contracts`.
    - **DTOs**: Define shared DTOs for inter-service communication.
    - _Rule_: NEVER hardcode topic names or event strings in services.

2.  **Implementation**
    Implement the logic in `apps/*` (Services) and `libs/*` (Shared).
    - **Communication**: Use Kafka for async flows.
    - **Database**: Use `@libs/scylla` for Chat/Interaction, `@libs/database` (Postgres) for Auth/Users.
    - **Auth**: Ensure `JwtAuthGuard` or `WsAuthGuard` is applied.
    - **Conventions**: Use Path Aliases (`@libs/...`).

3.  **REST API Flow (BFF Pattern)**
    For HTTP endpoints, strict adherence to the **OpenAPI Codegen** flow is required:
    - **Step 3.1: Backend Service (`apps/*-service`)**
      - Implement `Controller`, `Service`, and `DTOs`.
      - MUST use `@nestjs/swagger` decorators (`@ApiOperation`, `@ApiResponse`, `@ApiProperty`) to fully document the endpoint.
    - **Step 3.2: Update Client SDK (`libs/clients`)**
      - Extract the new Swagger definition (run service → local Swagger UI JSON) or manually update `libs/clients/src/<service>-client/src/utils/oas.yml`.
      - Run codegen: `pnpm run codegen:<service>` (e.g., `sso`, `interaction`, `chat`).
      - Verify `libs/clients/src/<service>-client/src/client/generated` has the new methods.
    - **Step 3.3: BFF Integration (`apps/bff-service`)**
      - Inject the client service (e.g., `SsoClientService` or generated `AuthApi`).
      - Implement the BFF Controller to proxy/aggregate the request.
      - Apply `DTO` validation at the BFF level to fail fast.

4.  **Mandatory Verification**
    You must run the build and lint commands. If they fail, FIX them immediately.
    - Run: `pnpm run build:all`
    - Run: `pnpm run lint`

5.  **Final Reporting**
    Append the **Code Change Report** to your final response.

    ```markdown
    ### 🧾 Code Change Report

    - **Summary**: ...
    - **Reason**: ...
    - **Affected files**: ...
    - **Validation**:
      - pnpm run build:all → ✅ Passed
      - pnpm run lint → ✅ Passed
    ```

6.  **Request Code Review**
    After the task is 100% complete and the report is generated, you MUST include the following tag at the very end of your response to trigger the automatic review process:

    `[locdeptrai] review please`
