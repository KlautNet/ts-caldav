# Contributing

## We welcome contributions! Follow the steps below to get started

1. Fork the repository.
2. Clone your fork:

   ```bash
   git clone https://github.com/your-username/ts-caldav.git
   cd caldav-client
   ```

3. Install dependencies:

   ```bash
   pnpm install
   ```

4. Add the environment variables needed for testing
   The account referenced should have at least one calendar with at least one event.

    ```env
    CALDAV_BASE_URL=
    CALDAV_USERNAME=
    CALDAV_PASSWORD=
    ```

5. Create a new branch for your feature:

   ```bash
   git checkout -b feature-name
   ```

6. Make your changes and run tests:

   ```bash
   pnpm test
   ```

7. Lint your code:

   ```bash
   pnpm run lint
   ```

8. Commit and push your changes:

   ```bash
   git add .
   git commit -m "Add feature-name"
   git push origin feature-name
   ```

9. Open a pull request.

### Code Style

This project uses [ESLint](https://eslint.org/) for consistent code style. Run `pnpm run lint` to check for linting errors.
