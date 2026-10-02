function [run, signals] = replayRun(filename, animate)
%REPLAYRUN Import a Raahi JSON export and plot/replay recorded ego states.
% This is a replay bridge, NOT a MATLAB implementation of the planner.
% MATLAB R2019b+ is recommended (jsondecode, tiledlayout, timeseries).
% Usage: [run, signals] = replayRun('artifacts/village-42.json', false);

if nargin < 2, animate = false; end
run = jsondecode(fileread(filename));
assert(isfield(run, 'schemaVersion') && run.schemaVersion == 1, ...
    'Expected a version-1 Raahi run export, not the batch summary.');
assert(~isempty(run.trajectory), 'The run has no recorded simulation steps.');
trace = struct2table(run.trajectory);
signalNames = {'x', 'y', 'yaw', 'speed', 'acceleration', 'steer', 'curvature'};
signals = struct();
for i = 1:numel(signalNames)
    name = signalNames{i};
    signals.(name) = timeseries(trace.(name), trace.t, 'Name', name);
end

figure('Name', ['Raahi replay: ' run.scenario.name], 'Color', 'w');
tiledlayout(2, 2, 'TileSpacing', 'compact');
ax = nexttile([1, 2]);
x = linspace(0, run.scenario.length, 400);
centre = zeros(size(x));
if isfield(run.scenario, 'bend')
    centre = run.scenario.bend * sin(x / 32);
end
width = run.scenario.halfWidth;
patch(ax, [x fliplr(x)], [centre + width fliplr(centre - width)], ...
    [0.91 0.93 0.90], 'EdgeColor', 'none');
hold(ax, 'on');
plot(ax, trace.x, trace.y, 'Color', [0.22 0.43 0.27], 'LineWidth', 1.5);
ego = plot(ax, trace.x(1), trace.y(1), 'o', 'MarkerSize', 8, ...
    'MarkerFaceColor', [0.55 0.72 0.31], 'MarkerEdgeColor', [0.22 0.43 0.27]);
axis(ax, 'equal'); xlim(ax, [0 run.scenario.length]);
ylim(ax, [-width-3 width+3]); grid(ax, 'on');
xlabel(ax, 'x (m)'); ylabel(ax, 'y (m)');
title(ax, [run.scenario.name ' — recorded ego motion']);

nexttile;
plot(trace.t, trace.speed * 3.6, 'LineWidth', 1.4); grid on;
xlabel('Time (s)'); ylabel('Speed (km/h)');
nexttile;
plot(trace.t, trace.curvature, 'LineWidth', 1.4); grid on;
xlabel('Time (s)'); ylabel('Curvature (1/m)');
fprintf('%s | %s | collisions: %d | minimum clearance: %.3f m\n', ...
    run.scenario.id, run.metrics.status, run.metrics.collisions, ...
    run.metrics.minClearanceMetres);
fprintf('Planner p95: %.3f ms (measured in the original JavaScript run)\n', ...
    run.metrics.p95ReplanMs);

if animate
    for i = 1:2:height(trace)
        if ~isgraphics(ego), break; end
        set(ego, 'XData', trace.x(i), 'YData', trace.y(i));
        title(ax, sprintf('%s | t = %.1f s | %.1f km/h', ...
            run.scenario.name, trace.t(i), trace.speed(i) * 3.6));
        drawnow;
        pause(0.03); % Accelerated visualization; timing is not real-time validation.
    end
end
end
