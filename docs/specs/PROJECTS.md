# Projects

A project represents a set of application secrets stored in a restic repository.

## Restic repository settings

Each project is defined with the settings required to connect to a restic repository over an S3-compatible backend:

- [x] `Name` — project display name (unique)
- [x] `Description` — optional free text
- [x] `S3 Endpoint` — hostname of the S3-compatible endpoint
- [x] `S3 Bucket` — bucket name
- [x] `Repository Prefix` — path prefix inside the bucket (defaults to the project name slugified when empty)
- [x] `S3 Region` — optional, passed to restic as `s3.region`
- [x] `S3 Bucket Lookup` — optional, passed to restic as `s3.bucket-lookup` (defaults to `dns`)
- [x] `S3 Access Key ID` — sensitive
- [x] `S3 Secret Access Key` — sensitive
- [x] `Restic Password` — repository encryption password, sensitive

## Lifecycle

- [x] Projects can be created by admins
- [x] Projects can be deleted by admins (deleting also deletes the project secrets from the application database; the restic repository is left untouched)
- [x] Projects can never be updated: settings are immutable after creation

## Setup confidence

- [x] The create-project dialog offers a read-only "Test connection" action: it validates the S3 endpoint, bucket and credentials and the restic password by invoking restic without writing to the repository
- [x] The connection test reports "repository is empty (it will be initialized on the first push)" when the repository does not exist yet, "N snapshots found" when it is reachable, or a clear error message when the credentials or the endpoint are wrong
- [x] The connection test is limited in time so an unreachable endpoint cannot hang the dialog indefinitely
- [x] Before creation, a confirmation summary step shows the settings that were entered (secret key and restic password masked) and warns that the settings cannot be changed after creation
- [x] Project settings remain immutable: a mistake is corrected by deleting and re-creating the project, which the test and review steps aim to make rare

## Visibility

- [x] Admins see all projects
- [x] Regular users only see the projects they have been granted access to
- [x] Admin visibility is resolved from the live database role, not from the session token: a demoted admin immediately loses cross-project access
- [x] Users without access to any project see an empty list

Last spec review: 2026-10-22
