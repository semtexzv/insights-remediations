'use strict';

const _ = require('lodash');
const URI = require('urijs');
const uuid = require('uuid/v4');

const DEFAULT_REMEDIATION_NAME = 'unnamed-playbook';
const PLAYBOOK_SUFFIX = 'yml';
const config = require('../config');

const listLinkBuilder = (sort, system) => (limit, page) =>
    new URI(config.path.base)
    .segment('v1')
    .segment('remediations')
    .query({system, sort, limit, offset: page * limit})
    .toString();

function buildListLinks (total, limit, offset, sort, system) {
    const lastPage = Math.floor(Math.max(total - 1, 0) / limit);
    const currentPage = Math.floor(offset / limit);
    const remainder = offset % limit;
    const builder = listLinkBuilder(sort, system);

    const links = {
        first: builder(limit, 0),
        last: builder(limit, lastPage),

        previous: (offset > 0) ? builder(limit, (remainder === 0) ? currentPage - 1 : currentPage) : null,
        next: (currentPage < lastPage) ? builder(limit, currentPage + 1) : null
    };

    return links;
}

exports.list = function (remediations, total, limit, offset, sort, system) {
    const formatted = _.map(remediations,
        ({id, name, needs_reboot, created_by, created_at, updated_by, updated_at, system_count, issue_count}) => ({
            id,
            name,
            created_by: _.pick(created_by, ['username', 'first_name', 'last_name']),
            created_at: created_at.toISOString(),
            updated_by: _.pick(updated_by, ['username', 'first_name', 'last_name']),
            updated_at: updated_at.toISOString(),
            needs_reboot,
            system_count,
            issue_count
        })
    );

    return {
        meta: {
            count: remediations.length,
            total
        },
        links: buildListLinks(total, limit, offset, sort, system),
        data: formatted
    };
};

exports.get = function ({id, name, needs_reboot, auto_reboot, created_by, created_at, updated_by, updated_at, issues}) {
    return {
        id,
        name,
        needs_reboot,
        auto_reboot,
        created_by: _.pick(created_by, ['username', 'first_name', 'last_name']),
        created_at: created_at.toISOString(),
        updated_by: _.pick(updated_by, ['username', 'first_name', 'last_name']),
        updated_at: updated_at.toISOString(),
        issues: _.map(issues, ({issue_id, resolution, details, systems, resolutionsAvailable }) => ({
            id: issue_id,
            description: details.description,
            resolution: {
                id: resolution.type,
                description: resolution.description,
                resolution_risk: resolution.resolutionRisk,
                needs_reboot: resolution.needsReboot
            },
            resolutions_available: resolutionsAvailable,
            systems: systems.map(({system_id, hostname, display_name}) => ({
                id: system_id,
                hostname,
                display_name
            }))
        }))
    };
};

exports.created = function ({id}) {
    return {id};
};

function playbookNamePrefix (name) {
    if (!name || !name.length) {
        return DEFAULT_REMEDIATION_NAME;
    }

    let result = name.toLowerCase().trim(); // no capital letters
    result = result.replace(/\s+/g, '-'); // no whitespace
    result = result.replace(/[^\w-]/g, ''); // only alphanumeric, hyphens or underscore
    return result;
}

exports.playbookName = function (remediation) {
    const name = playbookNamePrefix(remediation.name);
    const fileName = [name, new Date().getTime()];

    // my-remediation-1462522068064.yml
    return `${fileName.join('-')}.${PLAYBOOK_SUFFIX}`;
};

exports.connectionStatus = function (executors) {
    const data = _(executors)
    .sortBy('name')
    .map(executor => ({
        executor_id: executor.satId || null,
        executor_type: executor.type,
        executor_name: executor.name,
        system_count: executor.systems.length,
        connection_status: executor.status
    }))
    .value();

    return {
        meta: {
            count: data.length,
            total: data.length
        },
        data
    };
};

function getUniqueHosts (issues) {
    return _(issues).flatMap('hosts').uniq().sort().value();
}

exports.playbookRunRequest = function (remediation, issues, playbook, playbookRunId) {
    const uniqueHosts = getUniqueHosts(issues);

    return {
        remediation_id: remediation.id,
        remediation_name: remediation.name,
        playbook_run_id: playbookRunId,
        account: remediation.account_number,
        hosts: uniqueHosts,
        playbook: playbook.yaml,
        config: {
            text_updates: config.fifi.text_updates,
            text_update_interval: config.fifi.text_update_interval,
            text_update_full: config.fifi.text_update_full
        }
    };
};

exports.receptorWorkRequest = function (playbookRunRequest, account_number, receptor_id) {
    return {
        account: account_number,
        recipient: receptor_id,
        payload: JSON.stringify(playbookRunRequest),
        directive: 'receptor_satellite:execute'
    };
};

exports.playbookRunsTableData = function (remediation, playbook_run_id) {
    return {
        id: playbook_run_id,
        status: 'pending',
        remediation_id: remediation.id,
        created_by: remediation.created_by,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
};

exports.gatherTableData = async function (workRequest, executor, {executorData, systemData}) {
    const executor_id = uuid();
    const payload = JSON.parse(workRequest.payload);

    const executorDetails = {
        id: executor_id,
        executor_id: executor.satId,
        executor_name: executor.name,
        receptor_node_id: uuid(),
        receptor_job_id: executor.receptorId,
        status: 'pending',
        updated_at: new Date().toISOString(),
        playbook: payload.playbook,
        playbook_run_id: payload.playbook_run_id
    };

    const systemDetails = _.map(executor.systems, system => ({
        id: uuid(),
        system_id: system.id,
        system_name: system.hostname,
        status: 'pending',
        sequence: 0,
        console: 'system log has started.',
        updated_at: new Date().toISOString(),
        playbook_run_executor_id: executor_id
    }));

    executorData = _.compact(_.concat(executorData, executorDetails));
    systemData = _.compact(_.concat(systemData, systemDetails));

    return {executorData, systemData};
};
