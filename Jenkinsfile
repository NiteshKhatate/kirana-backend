pipeline {
  // Dedicated Linux executor: repository-approved Node 20, npm, Docker + Compose.
  agent { label 'kirana-backend-ci' }
  options {
    skipDefaultCheckout(true)
    disableConcurrentBuilds()
    timeout(time: 60, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }
  parameters {
    booleanParam(name: 'DEPLOY_RENDER', defaultValue: false, description: 'After checks, request operator approval for the configured production service.')
    string(name: 'RENDER_SERVICE_ID', defaultValue: '', description: 'Existing srv- identifier; never a secret hook URL.')
    string(name: 'RENDER_BASE_URL', defaultValue: '', description: 'Existing HTTPS backend origin.')
    string(name: 'EXPECTED_DB_HOST', defaultValue: '', description: 'Reviewed production database host.')
    string(name: 'EXPECTED_DB_NAME', defaultValue: '', description: 'Reviewed production database name.')
    string(name: 'EXPECTED_DB_USER', defaultValue: '', description: 'Reviewed production database role.')
  }
  environment {
    DOCKER_BUILDKIT = '1'
  }
  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script { env.RELEASE_SHA = sh(script: 'git rev-parse HEAD', returnStdout: true).trim() }
        sh 'node -e "if(process.versions.node.split(\".\")[0] !== \"20\") process.exit(1)"'
        sh 'docker version && docker compose version'
      }
    }
    stage('Install and Prisma') {
      steps {
        sh 'npm ci'
        withEnv(['DATABASE_URL=postgresql://build:unused@127.0.0.1:5432/kirana_identity']) {
          sh 'npx --no-install prisma validate'
          sh 'npx --no-install prisma generate'
        }
      }
    }
    stage('Lint, types and unit tests') {
      steps {
        sh 'npm run lint:check'
        sh 'npx --no-install prettier --check "ops/*.cjs" render.yaml'
        sh 'npm run typecheck'
        sh 'npm test -- --runInBand'
        sh 'npm run test:ops'
        sh 'npm run test:e2e -- --runInBand'
      }
    }
    stage('PostgreSQL integration') {
      steps {
        // Lockable Resources plugin serializes the dedicated loopback port across jobs.
        lock(resource: 'kirana-backend-test-db-5434') {
          sh 'npm run db:test:setup'
          sh 'npm run test:integration'
        }
      }
    }
    stage('Production build and images') {
      steps {
        sh 'npm run build'
        sh 'docker build --target runtime --build-arg BUILD_SHA="$RELEASE_SHA" -t "kirana-backend:$RELEASE_SHA" .'
        sh 'docker build --target migration --build-arg BUILD_SHA="$RELEASE_SHA" -t "kirana-backend-migration:$RELEASE_SHA" .'
        lock(resource: 'kirana-backend-test-db-5434') {
          withEnv(["SMOKE_IMAGE=kirana-backend:${env.RELEASE_SHA}"]) {
            sh 'node ops/container-smoke.cjs'
          }
        }
        sh 'node ops/migration-manifest.cjs > migration-manifest.json'
        archiveArtifacts(artifacts: 'migration-manifest.json', fingerprint: true)
      }
    }
    stage('Approved production release') {
      when {
        allOf {
          branch 'main'
          expression { params.DEPLOY_RENDER && !env.CHANGE_ID }
        }
      }
      steps {
        lock(resource: 'kirana-backend-production-release') {
          script {
            def evidence = input(message: "Release tested commit ${env.RELEASE_SHA}? Review the archived migration manifest and SQL; verify an available backup/restore point and backward compatibility with the running application.", parameters: [
              string(name: 'BACKUP_REFERENCE', description: 'Privately verified backup/restore-point identifier. No URL with credentials.'),
              string(name: 'REVIEWED_DIGEST', description: 'Copy the reviewed manifest digest.'),
              booleanParam(name: 'APPROVE', defaultValue: false, description: 'Approve credentials use, reviewed migrations and deployment for this exact commit.')
            ])
            if (!evidence.APPROVE || !evidence.BACKUP_REFERENCE?.trim()) { error('Release approval is required.') }
            withEnv([
              "MIGRATION_BACKUP_REFERENCE=${evidence.BACKUP_REFERENCE}",
              "MIGRATION_REVIEWED_DIGEST=${evidence.REVIEWED_DIGEST}",
              "MIGRATION_APPROVED_SHA=${env.RELEASE_SHA}",
              "MIGRATION_EXPECTED_HOST=${params.EXPECTED_DB_HOST}",
              "MIGRATION_EXPECTED_DATABASE=${params.EXPECTED_DB_NAME}",
              "MIGRATION_EXPECTED_USER=${params.EXPECTED_DB_USER}",
              "RENDER_SERVICE_ID=${params.RENDER_SERVICE_ID}",
              "SMOKE_BASE_URL=${params.RENDER_BASE_URL}"
            ]) {
              // Bind only on a trusted main build after approval. Never interpolate secrets into Groovy/sh.
              withCredentials([
                string(credentialsId: 'kirana-production-database-url', variable: 'DATABASE_URL'),
                string(credentialsId: 'kirana-render-deploy-hook', variable: 'RENDER_DEPLOY_HOOK_URL'),
                string(credentialsId: 'kirana-render-api-key', variable: 'RENDER_API_KEY')
              ]) {
                sh '''set +x
                  node ops/render-deploy.cjs --check
                  docker run --rm --env NODE_ENV=production --env DATABASE_URL \
                    --env MIGRATION_APPROVED_SHA --env MIGRATION_REVIEWED_DIGEST --env MIGRATION_BACKUP_REFERENCE \
                    --env MIGRATION_EXPECTED_HOST --env MIGRATION_EXPECTED_DATABASE --env MIGRATION_EXPECTED_USER \
                    "kirana-backend-migration:$RELEASE_SHA"
                  node ops/render-deploy.cjs
                '''
              }
            }
          }
        }
      }
    }
  }
  post {
    always {
      // Do not remove shared PostgreSQL volumes or archive any runtime/test env files.
      echo 'See the stage results. A successful test/build run alone is not a production deployment.'
    }
  }
}
