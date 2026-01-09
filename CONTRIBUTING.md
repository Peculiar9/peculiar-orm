# Contributing to Peculiar ORM

First off, thanks for taking the time to contribute!

## How to Contribute

1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally:
    ```bash
    git clone https://github.com/your-username/peculiar-orm.git
    ```
3.  **Create a branch** for your feature or bugfix:
    ```bash
    git checkout -b feature/amazing-feature
    ```
4.  **Install dependencies**:
    ```bash
    npm install
    ```
5.  **Make your changes**. Please ensure your code follows the existing style (TypeScript, structured logging, repository pattern).
6.  **Build** the project to ensure no errors:
    ```bash
    npm run build
    ```
7.  **Commit your changes** with descriptive commit messages.
8.  **Push to your branch**:
    ```bash
    git push origin feature/amazing-feature
    ```
9.  **Open a Pull Request** against the `main` branch of the official repository.

## Coding Standards

- **TypeScript**: Use strong typing whenever possible. Avoid `any`.
- **Inversify**: Respect the dependency injection patterns.
- **Logging**: Use the internal `Logger` class instead of `console.log` for library output.
- **Error Handling**: Use the custom error classes in `OrmError.ts`.

## Reporting Bugs

Please open an issue on GitHub with:
- A clear description of the bug.
- Steps to reproduce.
- Expected vs actual behavior.
- Version of `peculiar-orm` and Node.js.
