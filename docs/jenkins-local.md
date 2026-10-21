# Local Jenkins for Kirana

This free learning setup adds a Linux build agent to the existing `kirana-jenkins` controller at <http://localhost:8080>. It needs Docker Desktop in Linux-container mode. Run commands from the repository root in PowerShell (the Compose commands also work in Git Bash).

Executed preparation checks are recorded in [local Jenkins verification](jenkins-local-verification.md); an authenticated node connection and actual Jenkins job remain separate steps.

The controller schedules jobs. The agent supplies Java, Git, Node 20/npm, OpenSSL, Docker CLI, Compose and Buildx. A separate Docker-in-Docker daemon holds CI images and test PostgreSQL volumes. The agent shares its network namespace so the existing loopback-only test URL and Linux host-network smoke work without changing application safety checks. No Windows Docker socket or development database is mounted. The daemon is privileged; use this local agent only for your trusted repository, with no production credentials. Its socket is private and no Docker TCP port is published.

Node 20 is retained to match the current Jenkinsfile and application Dockerfile. This local learning environment does not resolve the separate supported-runtime release blocker. No dependency major, schema, existing migration or paid hosting setting is changed.

## 1. Build and start the isolated Docker daemon

```bash
docker compose -f docker-compose.jenkins.yml --profile agent build agent
docker compose -f docker-compose.jenkins.yml up -d --wait docker
docker network connect kirana-jenkins-local kirana-jenkins
```

Run the network-connect command once. If Docker reports that the endpoint already exists, the controller is already connected. The controller and its existing home volume are preserved.

## 2. Configure Jenkins in the browser

Install missing **Pipeline**, **Git**, **Credentials Binding** and **Lockable Resources** plugins under Manage Jenkins > Plugins. Then open Manage Jenkins > Nodes > New Node:

| Field                 | Value                                                     |
| --------------------- | --------------------------------------------------------- |
| Node name             | `kirana-backend-ci`                                       |
| Type                  | Permanent Agent                                           |
| Number of executors   | `1`                                                       |
| Remote root directory | `/home/jenkins/agent`                                     |
| Labels                | `kirana-backend-ci`                                       |
| Usage                 | Only build jobs with label expressions matching this node |
| Launch method         | Launch agents by connecting it to the controller          |

Save, then open the node page. Copy only its agent **secret** from the displayed launch command. Do not run that Java command on Windows. WebSocket transport requires no published agent TCP port.

Create `.env.jenkins.local` in the repository root with a private text editor:

```dotenv
JENKINS_AGENT_SECRET=REPLACE_WITH_THE_NODE_SECRET
```

This file is ignored by Git and excluded from both Docker build contexts. Do not paste secrets into chat, commit them, use shell command arguments to save them, or print the full Compose configuration. `.env.jenkins.local` is local agent authentication, not the backend `.env`.

## 3. Connect the agent

```bash
docker compose --env-file .env.jenkins.local -f docker-compose.jenkins.yml --profile agent up -d agent
docker exec kirana-jenkins-agent node --version
docker exec kirana-jenkins-agent npm --version
docker exec kirana-jenkins-agent git --version
docker exec kirana-jenkins-agent docker version
docker exec kirana-jenkins-agent docker compose version
```

The node should become online in Jenkins. An offline node can indicate a wrong secret/name, missing controller network connection, or incomplete Jenkins setup. Once online, set the built-in node's executors to `0` under Manage Jenkins > Nodes so builds use the agent.

## 4. Create the backend job

Create a **Multibranch Pipeline** named `kirana-backend`. Add a Git branch source pointing to your repository's remote URL (check `git remote -v`). For a private repository, add a read-only Git credential to Jenkins and select it in the branch source; never put a token in the URL. Build configuration: **by Jenkinsfile**, script path `Jenkinsfile`.

Scan the repository and run the desired branch. Jenkins checks out the committed remote branch; uncommitted/unpushed local files are not included. Keep **DEPLOY_RENDER=false**; leave Render/database release parameters empty and add no production credentials for this local exercise. No public webhook or tunnel is needed: use Scan Multibranch Pipeline Now / Build Now manually.

The job installs npm dependencies, validates/generates Prisma, checks lint/types, runs unit/operations/HTTP/integration tests, builds both application images and smoke-tests the runtime image. Test setup creates a separate ignored `.env.test` and applies the two original migrations only after checking the dedicated test database identity. Its volumes live inside the isolated CI daemon and do not share the Windows development/test databases.

If the job waits for an executor, check the agent is online and has the exact label. If the `lock` step is unknown, install Lockable Resources. The first run downloads dependencies/images and may take longer. Only a successful real Jenkins run closes the CI execution gate; infrastructure preflight alone does not.

## Stop and resume

```bash
docker compose --env-file .env.jenkins.local -f docker-compose.jenkins.yml --profile agent stop
docker stop kirana-jenkins
docker start kirana-jenkins
docker compose --env-file .env.jenkins.local -f docker-compose.jenkins.yml --profile agent up -d
```

All volumes are preserved. Do not remove volumes or prune this daemon to fix credentials. If the daemon container is recreated, recreate the agent as well (`up -d --force-recreate agent`) so it joins the new network namespace. Private workspace/test configuration and database volumes must be retained together.

References: [Jenkins agents](https://www.jenkins.io/doc/book/using/using-agents/), [official inbound agent image](https://github.com/jenkinsci/docker-agents/blob/master/README_inbound-agent.md), [Docker Compose services](https://docs.docker.com/reference/compose-file/services/).
